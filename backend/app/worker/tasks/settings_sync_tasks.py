# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
cluster.pull_master_settings — Slave, master'dan org ayarlarini ceker.

Master = otorite. Slave whitelist'li kategorileri periyodik (cluster_sync_interval)
+ acilista cekip yerel system_setting'e UPSERT eder.

  - Hassas degerler master'da COZULUP duz metin gelir; burada SLAVE'in kendi
    Fernet anahtariyla yeniden sifrelenir (FERNET_KEY ayni olmasa da calisir).
  - Upsert-only: master'da olmayan key slave'de SILINMEZ.
  - updated_by'a DOKUNULMAZ (UUID kolon; sync kaynakli satirlar NULL kalir).
  - Her key kendi SAVEPOINT'inde islenir: tek bozuk satir tum batch'i bozmaz.
  - Isole NullPool engine + asyncio.run (cluster_tasks ile ayni kalip;
    'Future attached to a different loop' tuzagini onler).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx
from celery.signals import worker_ready
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.setting import SystemSetting
from app.services import cluster_service
from app.services.settings_service import _get_fernet
from app.worker.celery_app import celery_app

logger = get_logger("celery.settings_sync")

_EXPORT_PATH = "/api/v1/cluster/settings-export"


async def _fetch_master_settings() -> list[dict] | None:
    settings = get_settings()
    if not settings.master_url:
        logger.warning("settings_sync.no_master_url")
        return None
    node_id = settings.node_id
    ts = datetime.now(timezone.utc).isoformat()
    body = b""  # GET — bos govde; master da sha256(b"") dogrular
    secret = settings.cluster_secret.get_secret_value()
    sig = cluster_service.compute_signature(node_id, ts, body, secret)
    headers = {
        cluster_service.HMAC_HEADER_NODE: node_id,
        cluster_service.HMAC_HEADER_TIMESTAMP: ts,
        cluster_service.HMAC_HEADER_SIGNATURE: sig,
    }
    url = settings.master_url.rstrip("/") + _EXPORT_PATH
    async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    return list(data.get("settings", []))


async def _upsert_one(db, fernet, item: dict) -> bool:
    category = item.get("category")
    key = item.get("key")
    if not category or not key:
        return False
    is_sensitive = bool(item.get("is_sensitive"))
    value = item.get("value")
    value_type = item.get("value_type") or "string"

    stmt = select(SystemSetting).where(
        SystemSetting.category == category,
        SystemSetting.key == key,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()

    if is_sensitive:
        if value is None or value == "":
            # master'da deger yok/cozulemedi -> mevcut slave degerini KORU
            return False
        enc = fernet.encrypt(value.encode()).decode()
        if existing:
            existing.encrypted_value = enc
            existing.value = None
            existing.value_type = value_type
            existing.is_sensitive = True
        else:
            db.add(
                SystemSetting(
                    category=category, key=key, value=None, encrypted_value=enc,
                    value_type=value_type, is_sensitive=True,
                    is_editable=bool(item.get("is_editable", True)),
                    description=item.get("description"),
                    description_en=item.get("description_en"),
                    default_value=item.get("default_value"),
                )
            )
        return True

    if existing:
        existing.value = value
        existing.encrypted_value = None
        existing.value_type = value_type
        existing.is_sensitive = False
    else:
        db.add(
            SystemSetting(
                category=category, key=key, value=value, encrypted_value=None,
                value_type=value_type, is_sensitive=False,
                is_editable=bool(item.get("is_editable", True)),
                description=item.get("description"),
                description_en=item.get("description_en"),
                default_value=item.get("default_value"),
            )
        )
    return True


async def _pull() -> dict:
    settings = get_settings()
    if not settings.is_slave:
        return {"skipped": "not_slave"}
    items = await _fetch_master_settings()
    if items is None:
        return {"skipped": "no_master_url"}

    engine = create_async_engine(settings.db_url, poolclass=NullPool)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    applied = 0
    failed = 0
    try:
        fernet = _get_fernet()
        async with sm() as db:
            for item in items:
                try:
                    async with db.begin_nested():  # SAVEPOINT — izole flush
                        changed = await _upsert_one(db, fernet, item)
                    if changed:
                        applied += 1
                except Exception as e:  # noqa: BLE001
                    failed += 1
                    logger.warning(
                        "settings_sync.upsert_failed",
                        key=f"{item.get('category')}.{item.get('key')}",
                        error=str(e),
                    )
            await db.commit()
    finally:
        await engine.dispose()

    logger.info(
        "settings_sync.done", received=len(items), applied=applied, failed=failed
    )
    return {"received": len(items), "applied": applied, "failed": failed}


@celery_app.task(name="cluster.pull_master_settings")
def pull_master_settings() -> dict:
    return asyncio.run(_pull())


@worker_ready.connect
def _pull_on_ready(**_kwargs) -> None:
    """Acilista bir kez cek (sadece slave)."""
    try:
        if get_settings().is_slave:
            pull_master_settings.delay()
    except Exception:  # noqa: BLE001
        pass

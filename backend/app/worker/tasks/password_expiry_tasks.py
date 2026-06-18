# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Periyodik parola expiry sweep (master).

`password.max_age_days` suresini gecmis parolalari 3.parti POSIX uygulamalardan
shadowExpire=1 ile kilitler. Bu task SADECE kilitler; acma islemi parola
degisiminde (_clear_shadow_lock / ilgili patch'ler) yapilir.

"Son degisim gunu" oncelik sirasi:
  1) pwdChangedTime (ppolicy operational; sadece bazi kullanicilarda var)
  2) shadowLastChange (POSIX gun; parola degisiminde set ediliyor)
  3) ikisi de yoksa -> BASELINE: shadowLastChange=bugun yaz, KILITLEME
     (saat bugunden baslar; ilk calismada toplu kilit olmaz)

Guvenlik:
  - MTL_EXPIRY_DRY_RUN (varsayilan "1"): hicbir sey degistirmez, sadece loglar.
    Hazir olununca master env'de MTL_EXPIRY_DRY_RUN=0 + beat restart.
  - max_age_days <= 0 -> expiry kapali, no-op.
  - Sadece master'da calisir (is_master guard).
  - Per-user try/except: tek kullanici patlarsa sweep durmaz.
"""
from __future__ import annotations

import asyncio
import os
import time
from contextlib import asynccontextmanager as _asynccontextmanager
from datetime import datetime, timezone

from ldap3 import MODIFY_ADD, MODIFY_REPLACE

from app.core.config import get_settings
from app.core.logging import get_logger
from app.worker.celery_app import celery_app

logger = get_logger(__name__)

PEOPLE_FILTER = "(uid=*)"


# --- izole engine (loop-safe; cluster_tasks ile ayni kalip) ----------------
@_asynccontextmanager
async def _isolated_session():
    from sqlalchemy.ext.asyncio import (
        AsyncSession as _AsyncSession,
        async_sessionmaker as _async_sessionmaker,
        create_async_engine as _create_async_engine,
    )
    from sqlalchemy.pool import NullPool as _NullPool

    _settings = get_settings()
    _engine = _create_async_engine(
        _settings.db_url,
        echo=False,
        poolclass=_NullPool,
        connect_args={
            "server_settings": {
                "application_name": f"mtl-{_settings.node_id}-expiry",
                "timezone": "UTC",
            }
        },
    )
    _maker = _async_sessionmaker(
        _engine, class_=_AsyncSession, expire_on_commit=False, autoflush=False
    )
    try:
        async with _maker() as _session:
            try:
                yield _session
            except Exception:
                await _session.rollback()
                raise
    finally:
        await _engine.dispose()


def _dry_run() -> bool:
    return os.environ.get("MTL_EXPIRY_DRY_RUN", "1").strip().lower() not in (
        "0", "false", "no", "off",
    )


def _attr(entry, name):
    try:
        if name in entry:
            return entry[name].value
    except Exception:  # noqa: BLE001
        pass
    return None


def _changed_day(pwd_ct, slc):
    """Son parola degisimini 'epoch gun' olarak dondur; bilinmiyorsa None."""
    if pwd_ct is not None:
        if isinstance(pwd_ct, datetime):
            try:
                return int(pwd_ct.timestamp() // 86400)
            except Exception:  # noqa: BLE001
                pass
        s = str(pwd_ct).strip()
        try:
            dt = datetime.strptime(s[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
            return int(dt.timestamp() // 86400)
        except ValueError:
            pass
    if slc is not None:
        try:
            return int(slc)
        except (ValueError, TypeError):
            pass
    return None


async def _read_max_age_days() -> int:
    from sqlalchemy import select
    from app.models.setting import SystemSetting

    async with _isolated_session() as db:
        rows = (
            await db.execute(
                select(SystemSetting).where(SystemSetting.category == "password_policy")
            )
        ).scalars().all()
    for r in rows:
        if str(r.key).endswith("max_age_days"):
            try:
                return int(str(r.value or "0").strip())
            except (ValueError, TypeError):
                return 0
    return 0


async def _sweep_async() -> dict:
    max_age_days = await _read_max_age_days()
    if max_age_days <= 0:
        logger.info("password.expiry.disabled", max_age_days=max_age_days)
        return {"disabled": True, "max_age_days": max_age_days}

    dry = _dry_run()

    from app.core.ldap import get_ldap, init_ldap
    from app.services.ldap_user_service import _set_shadow_lock

    init_ldap()
    client = get_ldap()
    base_people = f"ou=people,{get_settings().ldap_base_dn}"
    today_day = int(time.time() // 86400)

    locked = baselined = not_expired = already = errors = 0
    samples: list[str] = []

    with client.write() as conn:
        conn.search(
            base_people,
            PEOPLE_FILTER,
            attributes=["uid", "pwdChangedTime", "shadowLastChange", "shadowExpire"],
            size_limit=0,
        )
        entries = list(conn.entries)
        for entry in entries:
            dn = entry.entry_dn
            uid = _attr(entry, "uid")
            uid = str(uid) if uid is not None else dn
            cday = _changed_day(_attr(entry, "pwdChangedTime"), _attr(entry, "shadowLastChange"))
            se = _attr(entry, "shadowExpire")
            try:
                if cday is None:
                    if not dry:
                        conn.modify(dn, {"objectClass": [(MODIFY_ADD, ["shadowAccount"])]})
                        conn.modify(dn, {"shadowLastChange": [(MODIFY_REPLACE, [str(today_day)])]})
                    baselined += 1
                    if len(samples) < 15:
                        samples.append(f"baseline:{uid}")
                    continue
                age = today_day - cday
                if age > max_age_days:
                    if str(se) == "1":
                        already += 1
                        continue
                    if not dry:
                        _set_shadow_lock(conn, dn, uid)
                    locked += 1
                    if len(samples) < 15:
                        samples.append(f"lock:{uid}(age={age}d)")
                else:
                    not_expired += 1
            except Exception as e:  # noqa: BLE001
                errors += 1
                logger.warning("password.expiry.user_failed", uid=uid, error=str(e))

    summary = {
        "dry_run": dry,
        "max_age_days": max_age_days,
        "total": len(entries),
        "locked": locked,
        "baselined": baselined,
        "already_locked": already,
        "not_expired": not_expired,
        "errors": errors,
        "samples": samples,
    }
    logger.info("password.expiry.sweep_done", **summary)
    return summary


@celery_app.task(name="password.sweep_expired", bind=True, max_retries=0)
def sweep_expired_passwords(self) -> dict:
    """Gunde bir: suresi dolan parolalari 3.partiden kilitle (master-only)."""
    settings = get_settings()
    if not settings.is_master:
        return {"skipped": "not_master"}
    logger.info("password.expiry.sweep_started")
    try:
        return asyncio.run(_sweep_async())
    except Exception as e:  # noqa: BLE001
        logger.exception("password.expiry.task_failed", error=str(e))
        raise

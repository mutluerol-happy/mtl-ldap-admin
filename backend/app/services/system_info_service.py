# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""System info gathering — versiyon, profile, services, DB/Redis/LDAP detay.

Tüm getattr/try/except defansif. Eksik bilgi None döner, hata atmaz."""

from __future__ import annotations

import platform  # noqa: F401  (gelecekteki kullanım için)
import subprocess
import sys
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _attr(name: str, default: Any = None) -> Any:
    """settings'ten güvenli read. Birden fazla alternatif isim deneyerek."""
    return getattr(get_settings(), name, default)


def _systemctl_status(service: str) -> str:
    """systemctl is-active çağırır. Timeout/hata olursa 'unknown'."""
    try:
        res = subprocess.run(
            ["systemctl", "is-active", service],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        out = (res.stdout or "").strip()
        return out or "unknown"
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return "unknown"
    except Exception as e:  # noqa: BLE001
        logger.debug("systemctl_status failed for %s: %s", service, e)
        return "unknown"


_SERVICE_UNIT_CANDIDATES: dict[str, list[str]] = {
    # PG paketi surum-ekli unit adiyla gelir (Rocky/PGDG: postgresql-16).
    "postgresql": ["postgresql", "postgresql-16", "postgresql-15", "postgresql-14"],
}


def _service_status(name: str) -> str:
    """Servis durumu — birden cok olasi unit adini dener, biri active ise active."""
    candidates = _SERVICE_UNIT_CANDIDATES.get(name, [name])
    statuses = [_systemctl_status(c) for c in candidates]
    if "active" in statuses:
        return "active"
    for st in statuses:
        if st != "unknown":
            return st
    return "unknown"


async def get_system_info(db: AsyncSession) -> dict[str, Any]:
    """Tüm sistem bilgisi tek nesnede."""
    # Python
    python_version = sys.version.split()[0]

    # FastAPI
    fastapi_version: str | None = None
    try:
        import fastapi  # type: ignore

        fastapi_version = getattr(fastapi, "__version__", None)
    except ImportError:
        pass

    # DB version
    db_version: str | None = None
    db_name: str | None = None
    try:
        result = await db.execute(text("SHOW server_version"))
        v = result.scalar()
        if v:
            db_version = str(v)
    except Exception as e:  # noqa: BLE001
        logger.debug("db_version probe failed: %s", e)

    try:
        result = await db.execute(text("SELECT current_database()"))
        v = result.scalar()
        if v:
            db_name = str(v)
    except Exception:
        pass

    # Redis version
    redis_version: str | None = None
    try:
        from redis.asyncio import Redis  # type: ignore

        redis_url = _attr("redis_url")
        if redis_url:
            r = Redis.from_url(str(redis_url), socket_timeout=2)
            try:
                info = await r.info(section="server")
                redis_version = (info or {}).get("redis_version")
            finally:
                try:
                    await r.close()
                except Exception:
                    pass
    except Exception as e:  # noqa: BLE001
        logger.debug("redis_version probe failed: %s", e)

    # Profile + services
    profile = str(_attr("profile", "MASTER") or "MASTER").upper()
    if profile == "SLAVE":
        service_names = [
            "mtl-ldap",
            "mtl-ldap-worker",
            "nginx",
            "postgresql",
            "redis",
            "slapd",
        ]
    else:
        service_names = [
            "mtl-ldap-admin",
            "mtl-ldap-admin-worker",
            "mtl-ldap-admin-beat",
            "nginx",
            "postgresql",
            "redis",
            "slapd",
        ]

    services = [{"name": s, "status": _service_status(s)} for s in service_names]

    return {
        "version": str(_attr("version", "0.6.0") or "0.6.0"),
        "profile": profile,
        "node_id": str(_attr("node_id", "unknown") or "unknown"),
        "install_date": None,
        "python_version": python_version,
        "fastapi_version": fastapi_version,
        "db_name": db_name,
        "db_version": db_version,
        "redis_version": redis_version,
        "ldap_uri": _attr("ldap_uri"),
        "ldap_base_dn": _attr("ldap_base_dn"),
        "services": services,
    }

# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Healthcheck endpoint'leri.

  GET /api/v1/health        — Hızlı kontrol (200 dönüyorsa app çalışıyor)
  GET /api/v1/health/ready  — Detaylı: DB + Redis + LDAP hepsi sağlıklı mı?
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.db import check_db_health
from app.core.ldap import check_ldap_health
from app.core.redis_client import check_redis_health

router = APIRouter(tags=["health"])

_START_TIME = datetime.now(timezone.utc)


@router.get("/health", summary="Liveness — uygulama açık mı?")
async def health() -> dict[str, Any]:
    """
    Hızlı liveness kontrolü.

    Kubernetes liveness probe için. Sadece app yanıt veriyor mu kontrol eder,
    backend servisleri kontrol etmez.
    """
    settings = get_settings()
    return {
        "status": "ok",
        "service": "mtl-ldap-admin",
        "version": "0.1.0",
        "node_id": settings.node_id,
        "profile": settings.profile.value,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": (datetime.now(timezone.utc) - _START_TIME).total_seconds(),
    }


@router.get("/health/ready", summary="Readiness — tüm bağımlılıklar sağlıklı mı?")
async def readiness() -> JSONResponse:
    """
    Detaylı readiness — DB, Redis, LDAP hepsi sağlıklı mı?

    Herhangi biri unhealthy ise 503 döner. Bu da Kubernetes readiness probe
    için: hazır değilse trafik yönlendirme.
    """
    settings = get_settings()
    db = await check_db_health()
    redis = await check_redis_health()
    ldap = await check_ldap_health()

    all_healthy = all(
        comp.get("status") == "healthy" for comp in (db, redis, ldap)
    )

    payload = {
        "status": "ready" if all_healthy else "not_ready",
        "node_id": settings.node_id,
        "profile": settings.profile.value,
        "components": {
            "database": db,
            "redis": redis,
            "ldap": ldap,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    return JSONResponse(
        status_code=status.HTTP_200_OK if all_healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        content=payload,
    )

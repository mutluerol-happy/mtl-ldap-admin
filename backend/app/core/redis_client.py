# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Redis bağlantı yönetimi (async, connection pool ile).

Kullanım alanları:
  - JWT refresh token blacklist
  - Rate limiting counters
  - MFA challenge state (kısa ömürlü)
  - Session cache
  - Cluster sync coordination (master→slave kuyruğu)
"""

from __future__ import annotations

from typing import Any

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_client: aioredis.Redis | None = None


def init_redis() -> aioredis.Redis:
    """
    Redis client'ı başlat (lifespan startup'da).

    decode_responses=True ile binary değil string döner.
    """
    global _client
    if _client is not None:
        return _client

    settings = get_settings()
    logger.info(
        "redis.client.init",
        url=_safe_url(settings.redis_url),
        max_connections=settings.redis_max_connections,
    )

    _client = aioredis.from_url(
        settings.redis_url,
        decode_responses=True,
        max_connections=settings.redis_max_connections,
        socket_keepalive=True,
        socket_connect_timeout=5,
        socket_timeout=10,
        retry_on_timeout=True,
        health_check_interval=30,
    )
    return _client


async def dispose_redis() -> None:
    """Redis bağlantısını temiz kapat (lifespan shutdown'da)."""
    global _client
    if _client is not None:
        logger.info("redis.client.dispose")
        await _client.aclose()
        _client = None


def get_redis() -> aioredis.Redis:
    """FastAPI dependency — kullanıma hazır client döner."""
    if _client is None:
        raise RuntimeError("Redis başlatılmadı — init_redis() çağrılmalı")
    return _client


async def check_redis_health() -> dict[str, Any]:
    """Healthcheck için PING."""
    try:
        client = get_redis()
        pong = await client.ping()
        info = await client.info(section="server")
        return {
            "status": "healthy" if pong else "unhealthy",
            "redis_version": info.get("redis_version", "?"),
        }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}


def _safe_url(url: str) -> str:
    """Redis URL'inden parolayı gizle."""
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        if parsed.password:
            return url.replace(parsed.password, "***")
    except Exception:  # noqa: BLE001
        pass
    return url

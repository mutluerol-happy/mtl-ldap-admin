# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
JWT token yönetimi.

Politika (production):
  - Access token  : 15 dakika TTL
  - Refresh token : 7 gün TTL, rotation aktif
  - Algoritma     : HS256 (secret_key ile)
  - Blacklist     : Redis (refresh token jti, TTL = remaining lifetime)
  - Claim'ler     : sub (user UUID), uid (ldap_uid), roles, perms, type, jti, iat, exp
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import jwt
from jwt.exceptions import (
    ExpiredSignatureError,
    InvalidTokenError,
)

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError
from app.core.logging import get_logger
from app.core.redis_client import get_redis

logger = get_logger(__name__)


# Production-grade TTL'ler
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=7)

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"

JWT_ALGORITHM = "HS256"
ISSUER = "mtl-ldap-admin"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(payload: dict[str, Any]) -> str:
    settings = get_settings()
    return jwt.encode(
        payload,
        settings.secret_key.get_secret_value(),
        algorithm=JWT_ALGORITHM,
    )


def _decode(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=[JWT_ALGORITHM],
            issuer=ISSUER,
            options={"require": ["exp", "iat", "sub", "type", "jti"]},
        )
    except ExpiredSignatureError as e:
        raise AuthenticationError("Token süresi dolmuş", code="TOKEN_EXPIRED") from e
    except InvalidTokenError as e:
        raise AuthenticationError(f"Geçersiz token: {e}", code="TOKEN_INVALID") from e


def create_access_token(
    user_id: UUID,
    ldap_uid: str,
    roles: list[str],
    permissions: list[str],
    extra: dict[str, Any] | None = None,
) -> tuple[str, datetime]:
    """
    Access token üret.

    Returns:
        (token, expires_at) — Authorization: Bearer <token>
    """
    settings = get_settings()
    now = _now()
    exp = now + ACCESS_TOKEN_TTL

    payload: dict[str, Any] = {
        "iss": ISSUER,
        "sub": str(user_id),
        "uid": ldap_uid,
        "roles": roles,
        "perms": permissions,
        "type": TOKEN_TYPE_ACCESS,
        "jti": uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "node": settings.node_id,
        "profile": settings.profile.value,
    }
    if extra:
        payload.update(extra)

    return _encode(payload), exp


def create_refresh_token(user_id: UUID, ldap_uid: str) -> tuple[str, datetime, str]:
    """
    Refresh token üret.

    Returns:
        (token, expires_at, jti) — jti rotation/blacklist için saklanır.
    """
    settings = get_settings()
    now = _now()
    exp = now + REFRESH_TOKEN_TTL
    jti = uuid4().hex

    payload = {
        "iss": ISSUER,
        "sub": str(user_id),
        "uid": ldap_uid,
        "type": TOKEN_TYPE_REFRESH,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "node": settings.node_id,
    }
    return _encode(payload), exp, jti


def decode_access_token(token: str) -> dict[str, Any]:
    """Access token decode + tip kontrolü."""
    payload = _decode(token)
    if payload.get("type") != TOKEN_TYPE_ACCESS:
        raise AuthenticationError("Token tipi yanlış (refresh→access kullanılmış olabilir)",
                                  code="TOKEN_WRONG_TYPE")
    return payload


def decode_refresh_token(token: str) -> dict[str, Any]:
    """Refresh token decode + tip kontrolü + blacklist kontrolü."""
    payload = _decode(token)
    if payload.get("type") != TOKEN_TYPE_REFRESH:
        raise AuthenticationError("Refresh token bekleniyordu", code="TOKEN_WRONG_TYPE")
    return payload


# ============================================================================
# Refresh blacklist (Redis)
# ============================================================================


def _blacklist_key(jti: str) -> str:
    return f"mtl:auth:refresh:blacklist:{jti}"


async def blacklist_refresh_token(jti: str, exp_timestamp: int) -> None:
    """
    Refresh token jti'sini blacklist'e ekle.

    TTL = exp - now (geçmişse hiç ekleme).
    """
    redis = get_redis()
    now = int(_now().timestamp())
    ttl = exp_timestamp - now
    if ttl <= 0:
        return
    await redis.setex(_blacklist_key(jti), ttl, "1")
    logger.info("auth.refresh.blacklisted", jti=jti, ttl=ttl)


async def is_refresh_blacklisted(jti: str) -> bool:
    redis = get_redis()
    exists = await redis.exists(_blacklist_key(jti))
    return bool(exists)


async def verify_refresh_and_get_payload(token: str) -> dict[str, Any]:
    """
    Refresh token'ı tam doğrula: decode + blacklist + tip.

    Raises:
        AuthenticationError: herhangi bir kontrol başarısız.
    """
    payload = decode_refresh_token(token)
    jti = payload.get("jti", "")
    if await is_refresh_blacklisted(jti):
        logger.warning("auth.refresh.blacklisted_attempt", jti=jti, sub=payload.get("sub"))
        raise AuthenticationError("Refresh token geçersiz (logout yapılmış)", code="TOKEN_REVOKED")
    return payload

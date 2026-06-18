# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
FastAPI dependency'leri.

  - get_current_admin       : JWT decode + AdminAccount yükle
  - require_permission      : permission code zorunlu kıl
  - require_master          : sadece master sunucuda çalışsın
  - get_request_meta        : IP + UA + trace_id
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session
from app.core.exceptions import AuthenticationError, AuthorizationError, ReadOnlyError
from app.core.logging import get_logger
from app.models.admin import AdminAccount
from app.services import jwt_service
from app.services.admin_service import get_admin_by_id, get_admin_permissions

logger = get_logger(__name__)

_bearer = HTTPBearer(auto_error=False, description="JWT access token")


async def get_current_admin(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> AdminAccount:
    if creds is None or not creds.credentials:
        raise AuthenticationError("Yetkilendirme başlığı eksik", code="TOKEN_MISSING")

    payload = jwt_service.decode_access_token(creds.credentials)
    sub = payload.get("sub")
    if not sub:
        raise AuthenticationError("Token sub yok", code="TOKEN_CORRUPT")

    from uuid import UUID

    try:
        admin_id = UUID(sub)
    except ValueError as e:
        raise AuthenticationError("Token sub bozuk", code="TOKEN_CORRUPT") from e

    admin = await get_admin_by_id(db, admin_id)
    if admin is None or not admin.is_active:
        raise AuthenticationError("Kullanıcı bulunamadı veya devre dışı",
                                  code="USER_NOT_FOUND")
    return admin


def require_permission(perm_code: str):
    """Kullanım: _: None = Depends(require_permission('user.read'))"""

    async def _check(current: Annotated[AdminAccount, Depends(get_current_admin)]) -> None:
        perms = get_admin_permissions(current)
        if perm_code not in perms and "*" not in perms:
            logger.warning("api.permission_denied", user=current.username, required=perm_code)
            raise AuthorizationError(
                f"Bu işlem için '{perm_code}' yetkisi gerekli",
                details={"required_permission": perm_code},
            )

    return _check


def require_any_permission(*perm_codes: str):
    async def _check(current: Annotated[AdminAccount, Depends(get_current_admin)]) -> None:
        perms = get_admin_permissions(current)
        if "*" in perms:
            return
        if not any(p in perms for p in perm_codes):
            raise AuthorizationError(
                f"Şu yetkilerden biri gerekli: {', '.join(perm_codes)}",
                details={"required_any": list(perm_codes)},
            )

    return _check


async def require_master(_: Request) -> None:
    settings = get_settings()
    if not settings.is_master:
        raise ReadOnlyError(
            "Bu işlem yalnızca master sunucudan yapılabilir",
            details={"current_profile": settings.profile.value, "master_url": settings.master_url},
        )


def _extract_client_ip(request: Request) -> str | None:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


async def get_request_meta(request: Request) -> dict[str, str | None]:
    return {
        "ip": _extract_client_ip(request),
        "user_agent": request.headers.get("user-agent"),
        "trace_id": getattr(request.state, "trace_id", None),
    }


CurrentAdmin = Annotated[AdminAccount, Depends(get_current_admin)]
DbSession = Annotated[AsyncSession, Depends(get_session)]

# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Auth endpoint'leri (AdminAccount tabanlı).

  POST   /auth/login              kullanıcı adı + parola
  POST   /auth/mfa/challenge      login sonrası TOTP doğrulama
  POST   /auth/mfa/setup          (authenticated VEYA mfa_setup_token)
  POST   /auth/mfa/verify         (authenticated VEYA mfa_setup_token)
  POST   /auth/mfa/disable        (authenticated)
  POST   /auth/refresh
  POST   /auth/logout
  GET    /auth/me
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, Request, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    CurrentAdmin,
    DbSession,
    get_request_meta,
)
from app.core.i18n import t, get_current_lang
from app.core.exceptions import AuthenticationError
from app.core.logging import get_logger
from app.models.admin import AdminAccount
from app.schemas.auth import (
    AdminPublic,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    MfaChallengeRequest,
    MfaSetupResponse,
    MfaVerifyRequest,
    RefreshRequest,
    RolePublic,
    TokenPair,
)
from app.schemas.users import PasswordChangeRequest
from app.services import auth_service, settings_service
from app.services.admin_service import (
    get_admin_by_id,
    get_admin_permissions,
    get_admin_roles,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# ============================================================================
# Login flow
# ============================================================================


@router.post(
    "/login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Kullanıcı girişi",
)
async def login(
    payload: LoginRequest,
    db: DbSession,
    request: Request,
    meta: Annotated[dict, Depends(get_request_meta)],
) -> LoginResponse:
    return await auth_service.login(
        db=db,
        username=payload.username,
        password=payload.password,
        ip=meta["ip"],
        user_agent=meta["user_agent"],
        request_id=meta["trace_id"],
    )


@router.post(
    "/mfa/challenge",
    response_model=LoginResponse,
    summary="Login sonrası MFA challenge'ı TOTP ile tamamla",
)
async def mfa_challenge(
    payload: MfaChallengeRequest,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
) -> LoginResponse:
    return await auth_service.complete_mfa_challenge(
        db=db,
        challenge_id=payload.mfa_challenge_id,
        totp_code=payload.totp_code,
        ip=meta["ip"],
        user_agent=meta["user_agent"],
        request_id=meta["trace_id"],
    )


# ============================================================================
# Refresh / Logout
# ============================================================================


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Refresh token rotation",
)
async def refresh(payload: RefreshRequest, db: DbSession) -> TokenPair:
    return await auth_service.refresh_tokens(db=db, refresh_token=payload.refresh_token)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Refresh token revoke",
)
async def logout(payload: LogoutRequest) -> Response:
    await auth_service.logout(payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ============================================================================
# Me
# ============================================================================


@router.get(
    "/me",
    response_model=AdminPublic,
    summary="Mevcut kullanıcı bilgisi",
)
async def get_me(current: CurrentAdmin) -> AdminPublic:
    roles = get_admin_roles(current)
    perms = sorted(get_admin_permissions(current))
    return AdminPublic(
        id=current.id,
        username=current.username,
        email=current.email,
        display_name=current.display_name,
        is_active=current.is_active,
        mfa_enabled=current.mfa_enabled,
        last_login_at=current.last_login_at,
        roles=[
            RolePublic(
                id=r.id,
                name=r.name,
                description=r.description,
                is_system=r.is_system,
                requires_mfa=r.requires_mfa,
            )
            for r in roles
        ],
        permissions=perms,
    )


@router.get(
    "/session-policy",
    summary="Oturum politikası (idle timeout dakika; 0 = kapalı)",
)
async def session_policy(db: DbSession, current: CurrentAdmin) -> dict:
    """Frontend idle-logout için oturum politikası. Sadece authenticated."""
    try:
        raw = await settings_service.get_value(db, "security", "security.idle_timeout_minutes")
        minutes = int(raw) if raw not in (None, "") else 15
    except Exception:
        minutes = 15
    if minutes < 0:
        minutes = 0
    return {"idle_timeout_minutes": minutes}


# ============================================================================
# MFA setup (hem authenticated hem mfa_setup_token destekler)
# ============================================================================


async def _resolve_admin_for_mfa_setup(
    db: AsyncSession,
    creds_admin: AdminAccount | None,
    setup_token: str | None,
) -> AdminAccount:
    """
    MFA setup/verify için admin'i çöz.

    İki yol:
      1. Authorization: Bearer <access_token>  → normal JWT
      2. X-MFA-Setup-Token: <token>            → ilk-login akışı için
    """
    if creds_admin is not None:
        return creds_admin

    if setup_token:
        admin_id = await auth_service.consume_mfa_setup_token(setup_token)
        admin = await get_admin_by_id(db, admin_id)
        if admin is None or not admin.is_active:
            raise AuthenticationError("Kullanıcı bulunamadı", code="USER_NOT_FOUND")
        return admin

    raise AuthenticationError(
        "Kimlik doğrulama eksik (Authorization veya X-MFA-Setup-Token)",
        code="TOKEN_MISSING",
    )


async def _try_get_current_admin(
    db: AsyncSession,
    auth_header: str | None,
) -> AdminAccount | None:
    """
    Authorization header varsa decode et, yoksa None döner.

    Setup endpoint'lerinde token opsiyonel olduğu için raise etmiyoruz.
    """
    if not auth_header:
        return None
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header[7:].strip()
    if not token:
        return None
    try:
        from app.services import jwt_service
        payload = jwt_service.decode_access_token(token)
        admin_id = UUID(payload["sub"])
        return await get_admin_by_id(db, admin_id)
    except (AuthenticationError, ValueError, KeyError):
        return None


@router.post(
    "/mfa/setup",
    response_model=MfaSetupResponse,
    summary="TOTP secret üret + QR kod (henüz aktif değil, verify gerekli)",
)
async def mfa_setup(
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
    x_mfa_setup_token: Annotated[str | None, Header()] = None,
) -> MfaSetupResponse:
    current = await _try_get_current_admin(db, authorization)
    admin = await _resolve_admin_for_mfa_setup(db, current, x_mfa_setup_token)
    result = await auth_service.setup_mfa_for_admin(db, admin)
    return MfaSetupResponse(**result)


@router.post(
    "/mfa/verify",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Setup sonrası ilk TOTP'yi doğrula, MFA'yı aktif et",
)
async def mfa_verify(
    payload: MfaVerifyRequest,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
    x_mfa_setup_token: Annotated[str | None, Header()] = None,
) -> Response:
    current = await _try_get_current_admin(db, authorization)
    admin = await _resolve_admin_for_mfa_setup(db, current, x_mfa_setup_token)
    await auth_service.verify_and_enable_mfa(
        db, admin, payload.totp_code, consume_setup_token=x_mfa_setup_token
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/mfa/disable",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Kendi MFA'sını devre dışı bırak (TOTP gerekli)",
)
async def mfa_disable(
    payload: MfaVerifyRequest,
    current: CurrentAdmin,
    db: DbSession,
) -> Response:
    await auth_service.disable_mfa_for_admin(db, current, payload.totp_code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ============================================================================
# Self-service: kendi parolasını değiştir
# ============================================================================


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Giriş yapmış admin'in kendi parolasını değiştirmesi",
)
async def change_own_password(
    payload: PasswordChangeRequest,
    current: CurrentAdmin,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
) -> Response:
    """Mevcut parola doğrulanır, başarılıysa yeni parola yazılır.

    LDAP entry'si varsa orada da güncellenir. must_change_password false yapılır.
    """
    from datetime import datetime, timezone

    from ldap3 import MODIFY_REPLACE
    from passlib.hash import ldap_salted_sha1
    from app.core.exceptions import AuthenticationError, ValidationError
    from app.core.ldap import LDAPError, get_ldap
    from app.core.security import hash_password, verify_password
    from app.services import audit_service

    if not verify_password(payload.current_password, current.password_hash):
        await audit_service.log_event(
            db, category="SECURITY", event_code="PASSWORD_CHANGE_FAILED",
            severity="WARNING",
            actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
            ip_address=meta["ip"], user_agent=meta["user_agent"],
            details={"reason": "current_password_invalid"},
        )
        await db.commit()
        raise ValidationError(t("errors.currentPasswordInvalid", get_current_lang()), code="INVALID_CURRENT_PASSWORD")

    if payload.current_password == payload.new_password:
        raise ValidationError(
            "Yeni parola eski parolayla aynı olamaz",
            code="PASSWORD_SAME_AS_OLD",
        )

    # DB güncelle
    current.password_hash = hash_password(payload.new_password)
    current.password_changed_at = datetime.now(timezone.utc)
    current.must_change_password = False
    await db.flush()

    # LDAP entry varsa orada da güncelle
    if current.ldap_dn:
        try:
            ldap_client = get_ldap()
            hashed = ldap_salted_sha1.hash(payload.new_password)
            with ldap_client.write() as conn:
                conn.modify(current.ldap_dn, {"userPassword": [(MODIFY_REPLACE, [hashed])]})
        except LDAPError as e:
            logger.warning("auth.change_password.ldap_failed", admin_id=str(current.id), error=str(e))

    await audit_service.log_event(
        db, category="SECURITY", event_code="PASSWORD_CHANGED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ADMIN", target_id=str(current.id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ============================================================================
# Tur 4: must_change_password token ile parola değiştirme (login'den önce)
# ============================================================================


@router.post(
    "/change-password-with-token",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="must_change_password=true ise login'de verilen token ile parola değiştirme",
)
async def change_password_with_token(
    payload: PasswordChangeRequest,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
    x_password_change_token: Annotated[str | None, Header()] = None,
) -> Response:
    """Token ile change-password — yalnızca login'de must_change=true ise verilen token kabul edilir.

    Bu akışta `current_password` field'ı opsiyoneldir (token zaten doğrulama).
    Ama yine de set edilirse extra-doğrulama olarak kullanılır.
    """
    from datetime import datetime, timezone

    from ldap3 import MODIFY_REPLACE
    from passlib.hash import ldap_salted_sha1
    from sqlalchemy import select
    from app.core.exceptions import AuthenticationError, ValidationError
    from app.core.ldap import LDAPError, get_ldap
    from app.core.security import hash_password
    from app.models.admin import AdminAccount
    from app.services import audit_service, auth_service

    if not x_password_change_token:
        raise AuthenticationError(
            "X-Password-Change-Token başlığı gerekli",
            code="PASSWORD_CHANGE_TOKEN_MISSING",
        )

    admin_id = await auth_service.consume_password_change_token(db, x_password_change_token)

    stmt = select(AdminAccount).where(AdminAccount.id == admin_id)
    admin = (await db.execute(stmt)).scalar_one_or_none()
    if admin is None:
        raise AuthenticationError("Kullanıcı bulunamadı", code="USER_NOT_FOUND")

    # Parola politikası (Settings-driven) — Tur 10.1
    from app.services.password_policy_service import validate_password_async
    await validate_password_async(db, payload.new_password, username=admin.username)

    # Mevcut parola opsiyonel ek doğrulama (token zaten yetkili)
    # Yeni parola eski ile aynı olmamalı
    from app.core.security import verify_password as _vp
    if _vp(payload.new_password, admin.password_hash):
        raise ValidationError(
            "Yeni parola eski ile aynı olamaz",
            code="PASSWORD_SAME_AS_OLD",
        )

    # DB güncelle
    admin.password_hash = hash_password(payload.new_password)
    admin.password_changed_at = datetime.now(timezone.utc)
    admin.must_change_password = False
    await db.flush()

    # LDAP entry varsa onu da güncelle
    if admin.ldap_dn:
        try:
            ldap_client = get_ldap()
            hashed = ldap_salted_sha1.hash(payload.new_password)
            with ldap_client.write() as conn:
                conn.modify(admin.ldap_dn, {"userPassword": [(MODIFY_REPLACE, [hashed])]})
        except LDAPError as e:
            logger.warning("auth.token_change_password.ldap_failed",
                           admin_id=str(admin.id), error=str(e))

    await audit_service.log_event(
        db, category="SECURITY", event_code="PASSWORD_CHANGED_VIA_TOKEN",
        actor_type="ADMIN", actor_id=str(admin.id), actor_display=admin.username,
        target_type="ADMIN", target_id=str(admin.id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

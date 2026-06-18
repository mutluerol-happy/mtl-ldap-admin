# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
End-user self-service endpoint'leri (slave-side).

Endpoint'ler:
  POST /me/login                 → uid/parola ile login (LDAP bind)
  POST /me/mfa/challenge         → MFA challenge tamamla (TOTP)
  POST /me/logout                → token sonlandır
  GET  /me                       → token sahibi kullanıcı bilgisi
  POST /me/mfa/setup             → MFA enroll (TOTP secret + QR)
  POST /me/mfa/verify            → enroll'ı aktive et
  POST /me/mfa/disable           → MFA kapat
  POST /me/change-password       → kendi parolanı değiştir
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, status, Request
from fastapi.responses import Response

from app.api.deps import DbSession, get_request_meta
from app.core.exceptions import AuthenticationError
from app.schemas.password_reset import (
    EndUserChangePasswordRequest,
    EndUserLoginRequest,
    EndUserLoginResponse,
    EndUserMfaChallenge,
    EndUserMfaSetupResponse,
    EndUserMfaVerifyRequest,
    EndUserPublic,
)
from app.services import end_user_auth_service

router = APIRouter(prefix="/me", tags=["self-service"])


# ============================================================================
# Token dependency
# ============================================================================


async def get_current_end_user(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    """Bearer token → uid. Yoksa 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthenticationError(
            "Authorization Bearer token gerekli",
            code="MISSING_TOKEN",
        )
    token = authorization.split(None, 1)[1].strip()
    return await end_user_auth_service.resolve_end_user_token(token)


CurrentEndUserUid = Annotated[str, Depends(get_current_end_user)]


# ============================================================================
# Login flow
# ============================================================================


@router.post(
    "/login",
    response_model=EndUserLoginResponse,
    summary="End-user login (LDAP bind)",
)
async def login(
    payload: EndUserLoginRequest,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
) -> EndUserLoginResponse:
    result = await end_user_auth_service.login_end_user(
        db, uid=payload.uid, password=payload.password,
        ip=meta["ip"], user_agent=meta["user_agent"],
    )
    return EndUserLoginResponse(
        mfa_required=result.get("mfa_required", False),
        must_change_password=result.get("must_change_password", False),
        mfa_challenge_id=result.get("mfa_challenge_id"),
        access_token=result.get("access_token"),
        expires_in=result.get("expires_in"),
        user=EndUserPublic(**result["user"]) if result.get("user") else None,
    )


@router.post(
    "/mfa/challenge",
    response_model=EndUserLoginResponse,
    summary="MFA challenge tamamla — TOTP doğrula",
)
async def mfa_challenge(
    payload: EndUserMfaChallenge,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
) -> EndUserLoginResponse:
    result = await end_user_auth_service.complete_mfa_challenge(
        db, challenge_id=payload.mfa_challenge_id, totp_code=payload.totp_code,
        ip=meta["ip"], user_agent=meta["user_agent"],
    )
    return EndUserLoginResponse(
        mfa_required=False,
        must_change_password=result.get("must_change_password", False),
        access_token=result["access_token"],
        expires_in=result["expires_in"],
        user=EndUserPublic(**result["user"]) if result.get("user") else None,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Logout",
)
async def logout(
    authorization: Annotated[str | None, Header()] = None,
) -> Response:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
        await end_user_auth_service.logout_end_user(token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "",
    response_model=EndUserPublic,
    summary="Kendi profil bilgileri",
)
async def get_me(
    uid: CurrentEndUserUid,
    db: DbSession,
) -> EndUserPublic:
    from app.services.password_reset_service import _ldap_find_user
    from sqlalchemy import select
    from app.models.password_reset import EndUserMfaSecret

    user = _ldap_find_user(uid, None)
    if user is None:
        raise AuthenticationError("Kullanıcı bulunamadı", code="USER_NOT_FOUND")

    mfa_stmt = select(EndUserMfaSecret).where(
        EndUserMfaSecret.target_uid == uid,
        EndUserMfaSecret.enabled == True,  # noqa: E712
    )
    has_mfa = (await db.execute(mfa_stmt)).scalar_one_or_none() is not None

    return EndUserPublic(
        uid=user["uid"],
        cn=user.get("cn"),
        display_name=user.get("display_name"),
        email=user.get("mail"),
        mfa_enabled=has_mfa,
    )


# ============================================================================
# MFA self-enroll
# ============================================================================


@router.post(
    "/mfa/setup",
    response_model=EndUserMfaSetupResponse,
    summary="MFA setup başlat — TOTP secret + QR",
)
async def mfa_setup(
    uid: CurrentEndUserUid,
    db: DbSession,
) -> EndUserMfaSetupResponse:
    result = await end_user_auth_service.setup_mfa_for_end_user(db, uid)
    return EndUserMfaSetupResponse(**result)


@router.post(
    "/mfa/verify",
    summary="MFA setup'ı doğrula ve aktive et",
)
async def mfa_verify(
    payload: EndUserMfaVerifyRequest,
    uid: CurrentEndUserUid,
    db: DbSession,
) -> dict:
    return await end_user_auth_service.verify_and_enable_mfa(db, uid, payload.totp_code)


@router.post(
    "/mfa/disable",
    summary="MFA'yı devre dışı bırak (TOTP doğrulaması gerekli)",
)
async def mfa_disable(
    payload: EndUserMfaVerifyRequest,
    uid: CurrentEndUserUid,
    db: DbSession,
) -> dict:
    return await end_user_auth_service.disable_mfa(db, uid, payload.totp_code)


# ============================================================================
# Change password (giriş yapmış end-user için)
# ============================================================================


@router.post(
    "/change-password",
    summary="Mevcut parola ile yeni parola belirleme",
)
async def change_password(
    payload: EndUserChangePasswordRequest,
    uid: CurrentEndUserUid,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
    request: Request,
) -> dict:
    return await end_user_auth_service.change_password(
        db, uid=uid,
        current_password=payload.current_password,
        new_password=payload.new_password,
        ip=meta["ip"], user_agent=meta["user_agent"],
        lang=(
            (request.headers.get("x-lang") or "").lower() if (request.headers.get("x-lang") or "").lower() in ("tr", "en")
            else "tr"
        ),
    )

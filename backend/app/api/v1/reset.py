# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Slave-side parola reset endpoint'leri.

Bu router sadece slave node'da aktive olur (api/v1/__init__.py'de check var).

Endpoint'ler:
  POST /reset/request          → OTP üret + e-posta gönder (account enumeration koruması var)
  POST /reset/verify           → OTP doğrula, completion_token döndür
  POST /reset/complete         → completion_token + yeni parola → LDAP güncelle
  GET  /reset/policy           → UI için parola politikası
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import DbSession, get_request_meta
from app.schemas.password_reset import (
    PasswordPolicy,
    ResetCompletePayload,
    ResetCompleteResponse,
    ResetRequestPayload,
    ResetRequestResponse,
    ResetVerifyPayload,
    ResetVerifyResponse,
)
from app.services import password_reset_service

router = APIRouter(prefix="/reset", tags=["reset"])


@router.post(
    "/request",
    response_model=ResetRequestResponse,
    summary="Parola reset talebi (OTP gönder)",
)
async def request_reset(
    payload: ResetRequestPayload,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
) -> ResetRequestResponse:
    """uid veya email zorunlu. Açıklayıcı bilgi vermeyiz (account enum koruması)."""
    if not payload.uid and not payload.email:
        # Yine de 200 dön, hiç bir şey yapmadan
        return ResetRequestResponse(accepted=True, request_id=None)

    result = await password_reset_service.request_reset(
        db,
        uid=payload.uid,
        email=str(payload.email) if payload.email else None,
        ip=meta["ip"],
        user_agent=meta["user_agent"],
    )
    return ResetRequestResponse(
        accepted=result["accepted"],
        request_id=result.get("request_id"),
    )


@router.post(
    "/verify",
    response_model=ResetVerifyResponse,
    summary="OTP doğrula, completion_token al",
)
async def verify_otp(
    payload: ResetVerifyPayload,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
    request: Request,
) -> ResetVerifyResponse:
    _lang = (request.headers.get("x-lang") or "").lower()
    if _lang not in ("tr", "en"): _lang = "tr"
    result = await password_reset_service.verify_otp(
        db,
        uid=payload.uid,
        otp=payload.otp,
        ip=meta["ip"],
        user_agent=meta["user_agent"],
        lang=_lang,
    )
    return ResetVerifyResponse(
        verified=result["verified"],
        completion_token=result["completion_token"],
        expires_in=result["expires_in"],
    )


@router.post(
    "/complete",
    response_model=ResetCompleteResponse,
    summary="Yeni parola ile reset'i tamamla",
)
async def complete_reset(
    payload: ResetCompletePayload,
    db: DbSession,
    meta: Annotated[dict, Depends(get_request_meta)],
    request: Request,
) -> ResetCompleteResponse:
    _lang = (request.headers.get("x-lang") or "").lower()
    if _lang not in ("tr", "en"): _lang = "tr"
    await password_reset_service.complete_reset(
        db,
        completion_token=payload.completion_token,
        new_password=payload.new_password,
        ip=meta["ip"],
        user_agent=meta["user_agent"],
        lang=_lang,
    )
    return ResetCompleteResponse(completed=True)


@router.get(
    "/policy",
    response_model=PasswordPolicy,
    summary="Parola politikası (UI gösterimi için)",
)
async def get_policy(db: DbSession) -> PasswordPolicy:
    return PasswordPolicy(**(await password_reset_service.get_password_policy_async(db)))

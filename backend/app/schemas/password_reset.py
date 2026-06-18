# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Parola reset + end_user self-service şemaları."""

from __future__ import annotations

import re

from pydantic import BaseModel, EmailStr, Field, field_validator


_UID_PATTERN = re.compile(r"^[a-z][a-z0-9._-]{1,62}[a-z0-9]$")


class ResetRequestPayload(BaseModel):
    """Adım 1: kullanıcı uid + (email veya phone) gönderir, OTP üretilir + ilgili kanaldan gönderilir."""

    uid: str | None = Field(None, min_length=3, max_length=64)
    email: EmailStr | None = Field(None)
    phone: str | None = Field(None, min_length=8, max_length=20, description="E.164: +905551234567")
    channel: str | None = Field(
        None,
        description="email veya sms. 'both' modunda kullanıcı seçimi için.",
    )

    @field_validator("uid")
    @classmethod
    def _v_uid(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if not _UID_PATTERN.match(v):
            raise ValueError("Geçersiz kullanıcı adı formatı")
        return v

    @field_validator("phone")
    @classmethod
    def _v_phone(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().replace(" ", "").replace("-", "")
        if not re.match(r"^\+?\d{8,15}$", v):
            raise ValueError("Geçersiz telefon numarası (örn. +905551234567)")
        return v

    @field_validator("channel")
    @classmethod
    def _v_channel(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if v not in ("email", "sms"):
            raise ValueError("channel email veya sms olmalı")
        return v


class ResetRequestResponse(BaseModel):
    """Bilgi güvenliği: uid/email var olsa da olmasa da 200 dönülür (account enumeration önleme)."""

    accepted: bool = True
    message: str = "Eğer kayıtlı bir hesap bulunduysa, OTP e-posta adresine gönderildi."
    request_id: str | None = Field(
        None,
        description="Test/debug için. Production'da None döner.",
    )


class ResetVerifyPayload(BaseModel):
    """Adım 2: OTP doğrulama."""

    uid: str = Field(..., min_length=3, max_length=64)
    otp: str = Field(..., min_length=6, max_length=12)

    @field_validator("uid")
    @classmethod
    def _v_uid(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("otp")
    @classmethod
    def _v_otp(cls, v: str) -> str:
        v = v.strip().replace(" ", "").replace("-", "")
        if not v.isdigit():
            raise ValueError("OTP sadece rakam içermeli")
        return v


class ResetVerifyResponse(BaseModel):
    """Verify başarılıysa kısa ömürlü completion_token verilir."""

    verified: bool
    completion_token: str = Field(..., description="10 dk geçerli, sadece /reset/complete açar")
    expires_in: int


class ResetCompletePayload(BaseModel):
    """Adım 3: completion_token + yeni parola."""

    completion_token: str = Field(..., min_length=16, max_length=128)
    new_password: str = Field(..., min_length=1, max_length=128)


class ResetCompleteResponse(BaseModel):
    completed: bool = True
    message: str = "Parola başarıyla güncellendi. Yeni parolayla giriş yapabilirsiniz."


# ============================================================================
# Şifre politikası (UI'da göstermek için)
# ============================================================================

class PasswordPolicy(BaseModel):
    min_length: int
    max_length: int
    require_uppercase: bool
    require_lowercase: bool
    require_digit: bool
    require_special: bool
    forbidden_substrings: list[str] = Field(default_factory=list)
    reset_channel: str = Field(default="email", description="email, sms, both — UI buna göre input gösterir")


# ============================================================================
# End-user authentication (slave-side login)
# ============================================================================

class EndUserLoginRequest(BaseModel):
    uid: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)

    @field_validator("uid")
    @classmethod
    def _v_uid(cls, v: str) -> str:
        return v.strip().lower()


class EndUserPublic(BaseModel):
    uid: str
    cn: str | None = None
    display_name: str | None = None
    email: str | None = None
    mfa_enabled: bool = False
    must_change_password: bool = False


class EndUserLoginResponse(BaseModel):
    mfa_required: bool = False
    mfa_challenge_id: str | None = None
    access_token: str | None = None
    expires_in: int | None = None
    user: EndUserPublic | None = None
    must_change_password: bool = False


class EndUserMfaChallenge(BaseModel):
    mfa_challenge_id: str = Field(..., min_length=8)
    totp_code: str = Field(..., min_length=6, max_length=8)

    @field_validator("totp_code")
    @classmethod
    def _v_totp(cls, v: str) -> str:
        v = v.strip().replace(" ", "")
        if not v.isdigit():
            raise ValueError("TOTP kodu sadece rakam içermeli")
        return v


class EndUserMfaSetupResponse(BaseModel):
    secret: str
    qr_code_url: str
    qr_code_data_uri: str


class EndUserMfaVerifyRequest(BaseModel):
    totp_code: str = Field(..., min_length=6, max_length=8)


class EndUserChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=1, max_length=128)

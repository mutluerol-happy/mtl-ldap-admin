# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Auth endpoint'leri için Pydantic şemalar (AdminAccount tabanlı)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    """POST /auth/login isteği."""

    username: str = Field(..., min_length=1, max_length=128, examples=["happy"])
    password: str = Field(..., min_length=1, max_length=256)

    @field_validator("username")
    @classmethod
    def _normalize_username(cls, v: str) -> str:
        return v.strip().lower()


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int = Field(..., description="Access token TTL saniye")


class LoginResponse(BaseModel):
    """
    POST /auth/login yanıtı.

    Durumlar:
      1. Login OK, MFA gerek yok    → tokens dolu
      2. Login OK ama MFA gerekli   → mfa_required=True, mfa_challenge_id dolu
      3. Login OK ama MFA setup şart→ must_setup_mfa=True, mfa_setup_token dolu
    """

    mfa_required: bool = False
    mfa_challenge_id: str | None = None
    must_setup_mfa: bool = False
    mfa_setup_token: str | None = Field(
        None,
        description="Sınırlı yetkili token — sadece /auth/mfa/setup ve /auth/mfa/verify çağrılarına izin verir",
    )
    tokens: TokenPair | None = None
    user: "AdminPublic | None" = None

    # Tur 4: must_change_password akışı
    password_change_required: bool = False
    password_change_token: str | None = Field(
        None,
        description="must_change_password=true ise verilir. Sadece /auth/change-password endpoint'ini açar (5 dk geçerli).",
    )


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class MfaChallengeRequest(BaseModel):
    mfa_challenge_id: str = Field(..., min_length=8)
    totp_code: str = Field(..., min_length=6, max_length=8, examples=["123456"])

    @field_validator("totp_code")
    @classmethod
    def _digits_only(cls, v: str) -> str:
        v = v.strip().replace(" ", "")
        if not v.isdigit():
            raise ValueError("totp_code sadece rakam içermeli")
        return v


class MfaSetupResponse(BaseModel):
    secret: str = Field(..., description="Base32-encoded TOTP secret")
    qr_code_url: str = Field(..., description="otpauth:// URI")
    qr_code_data_uri: str = Field(..., description="data:image/png;base64,...")
    recovery_codes: list[str] = Field(default_factory=list)


class MfaVerifyRequest(BaseModel):
    totp_code: str = Field(..., min_length=6, max_length=8)


class RolePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str | None = None
    is_system: bool
    requires_mfa: bool


class AdminPublic(BaseModel):
    """Admin'in public bilgisi."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    email: str  # Not: EmailStr KULLANMIYORUZ — .local, .test gibi domain'leri kabul edebilmek için
    display_name: str
    is_active: bool
    mfa_enabled: bool
    last_login_at: datetime | None = None
    roles: list[RolePublic] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)


class ChangePasswordRequest(BaseModel):
    """POST /auth/change-password."""

    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=1, max_length=256)


# Forward reference resolve
LoginResponse.model_rebuild()

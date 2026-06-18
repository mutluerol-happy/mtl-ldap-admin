# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""User (LDAP end_user) Pydantic şemaları."""

from __future__ import annotations

import re
from app.core.i18n import t, get_current_lang
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Username/uid kuralları — LDAP-safe
_UID_PATTERN = re.compile(r"^[a-z][a-z0-9._-]{1,62}[a-z0-9]$")


def _validate_uid(value: str) -> str:
    """uid: küçük harf, rakam, ., _, -; 3-64 karakter, harfle başlar."""
    v = value.strip().lower()
    if not _UID_PATTERN.match(v):
        raise ValueError(
            "uid 3-64 karakter; küçük harf/rakam/./_/-; harfle başlar, harf veya rakamla biter"
        )
    return v


def _validate_password_complexity(value: str) -> str:
    """Min 12 char, en az 1 büyük + 1 küçük + 1 rakam + 1 özel."""
    if len(value) < 1:
        raise ValueError(t("errors.passwordEmpty", get_current_lang()))
    if not re.search(r"[A-Z]", value):
        raise ValueError(t("errors.passwordNoUpper", get_current_lang()))
    if not re.search(r"[a-z]", value):
        raise ValueError(t("errors.passwordNoLower", get_current_lang()))
    if not re.search(r"\d", value):
        raise ValueError(t("errors.passwordNoDigit", get_current_lang()))
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};:'\",.<>?/\\|`~]", value):
        raise ValueError(t("errors.passwordNoSpecial", get_current_lang()))
    return value


# ============================================================================
# Request şemaları
# ============================================================================


class UserCreateRequest(BaseModel):
    """POST /users — yeni LDAP user yarat."""

    uid: str = Field(..., min_length=3, max_length=64, examples=["alice"])
    cn: str = Field(..., min_length=1, max_length=128, examples=["Alice Smith"])
    sn: str = Field(..., min_length=1, max_length=64, examples=["Smith"])
    given_name: str | None = Field(None, max_length=64, examples=["Alice"])
    display_name: str | None = Field(None, max_length=128)
    email: str | None = Field(None, max_length=255, examples=["alice@mtl.local"])
    phone: str | None = Field(None, max_length=32)
    title: str | None = Field(None, max_length=128)
    department: str | None = Field(None, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)
    must_change_password: bool = Field(True, description="İlk login'de parola değiştirilsin mi")
    preferred_language: Literal["tr", "en"] = "tr"

    @field_validator("uid")
    @classmethod
    def _v_uid(cls, v: str) -> str:
        return _validate_uid(v)

    @field_validator("password")
    @classmethod
    def _v_pwd(cls, v: str) -> str:
        return _validate_password_complexity(v)


class UserUpdateRequest(BaseModel):
    """PATCH /users/{uid}"""

    cn: str | None = Field(None, max_length=128)
    sn: str | None = Field(None, max_length=64)
    given_name: str | None = Field(None, max_length=64)
    display_name: str | None = Field(None, max_length=128)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=32)
    title: str | None = Field(None, max_length=128)
    department: str | None = Field(None, max_length=128)
    is_active: bool | None = None
    preferred_language: Literal["tr", "en"] | None = None
    security_flags: dict[str, Any] | None = None


class PasswordChangeRequest(BaseModel):
    """POST /auth/change-password — kendi parolasını değiştir."""

    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=1, max_length=256)

    @field_validator("new_password")
    @classmethod
    def _v(cls, v: str) -> str:
        return _validate_password_complexity(v)


class AdminPasswordResetRequest(BaseModel):
    """POST /users/{uid}/reset-password — admin tarafından."""

    new_password: str = Field(..., min_length=1, max_length=256)
    must_change: bool = Field(True, description="Kullanıcı bir sonraki login'de değiştirsin mi")

    @field_validator("new_password")
    @classmethod
    def _v(cls, v: str) -> str:
        return _validate_password_complexity(v)


# ============================================================================
# Response şemaları
# ============================================================================


class UserPublic(BaseModel):
    """LDAP user'ın public görünümü (LDAP + DB metadata birleşik)."""

    model_config = ConfigDict(from_attributes=True)

    # LDAP attributes
    uid: str
    dn: str
    cn: str
    sn: str | None = None
    given_name: str | None = None
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    title: str | None = None
    department: str | None = None
    preferred_language: str | None = None

    # DB metadata
    metadata_id: UUID | None = None
    is_active: bool = True
    is_locked: bool = False
    locked_until: datetime | None = None
    failed_login_count: int = 0
    mfa_enabled: bool = False
    mfa_enrolled_at: datetime | None = None
    last_login_at: datetime | None = None
    last_login_ip: str | None = None
    must_change_password: bool = False
    password_changed_at: datetime | None = None
    password_expires_at: datetime | None = None
    security_flags: dict[str, Any] = Field(default_factory=dict)
    ldap_sync_status: str = "in_sync"


class UserListResponse(BaseModel):
    """GET /users — paginated."""

    total: int
    page: int
    page_size: int
    items: list[UserPublic]


# ============================================================================
# Bulk import
# ============================================================================


class BulkUserItem(BaseModel):
    """Tek bir user içeren bulk item."""

    uid: str = Field(..., min_length=3, max_length=64)
    cn: str = Field(..., min_length=1, max_length=128)
    sn: str = Field(..., min_length=1, max_length=64)
    given_name: str | None = Field(None, max_length=64)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=32)
    title: str | None = Field(None, max_length=128)
    department: str | None = Field(None, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)
    must_change_password: bool = True
    preferred_language: Literal["tr", "en"] = "tr"

    @field_validator("uid")
    @classmethod
    def _v(cls, v: str) -> str:
        return _validate_uid(v)


class BulkUserCreateRequest(BaseModel):
    """POST /users/bulk JSON."""

    items: list[BulkUserItem] = Field(..., min_length=1, max_length=10000)
    on_conflict: Literal["skip", "update", "fail"] = "skip"


class BulkImportJobPublic(BaseModel):
    """Bulk import job public görünüm."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_type: str
    status: str
    total_records: int
    processed_records: int
    successful_records: int
    failed_records: int
    source_filename: str | None
    source_format: str | None
    result_summary: dict[str, Any]
    error_log: list[dict[str, Any]]
    queued_at: datetime
    started_at: datetime | None
    completed_at: datetime | None

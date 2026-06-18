# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Admin yönetimi (DB-resident admin'ler için) Pydantic şemaları."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


_USERNAME_PATTERN = re.compile(r"^[a-z][a-z0-9._-]{1,62}[a-z0-9]$")


def _validate_username(v: str) -> str:
    v = v.strip().lower()
    if not _USERNAME_PATTERN.match(v):
        raise ValueError("username 3-64 karakter; küçük harf/rakam/./_/-")
    return v


def _validate_password(v: str) -> str:
    if len(v) < 1:
        raise ValueError("Parola boş olamaz")
    if not re.search(r"[A-Z]", v):
        raise ValueError("En az bir büyük harf gerekli")
    if not re.search(r"[a-z]", v):
        raise ValueError("En az bir küçük harf gerekli")
    if not re.search(r"\d", v):
        raise ValueError("En az bir rakam gerekli")
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};:'\",.<>?/\\|`~]", v):
        raise ValueError("En az bir özel karakter gerekli")
    return v


class AdminCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    display_name: str = Field(..., min_length=1, max_length=128)
    email: str = Field(..., min_length=3, max_length=255)
    password: str | None = Field(None, max_length=256)
    role_names: list[str] = Field(default_factory=list, description="Rol adları (örn. mtl.helpdesk)")
    must_change_password: bool = Field(True)
    create_in_ldap: bool = Field(True, description="LDAP'te de uid=<username>,ou=admins,... yarat")
    link_existing_uid: str | None = Field(
        None,
        min_length=3,
        max_length=64,
        description="Var olan LDAP kullanıcısı uid'si — set edildiğinde mevcut "
                    "ou=people altındaki user'a admin rolleri eklenir, "
                    "LDAP'te yeni entry oluşturulmaz",
    )

    @field_validator("username")
    @classmethod
    def _v_u(cls, v: str) -> str:
        return _validate_username(v)

    @field_validator("password")
    @classmethod
    def _v_p(cls, v: str | None) -> str | None:
        return v if v is None else _validate_password(v)

    @model_validator(mode="after")
    def _require_password_when_not_linking(self) -> "AdminCreateRequest":
        # link_existing_uid yoksa konsol parolasi zorunlu; varsa LDAP-bind ile
        # girilecegi icin password opsiyonel (None gelebilir).
        if not self.link_existing_uid and not self.password:
            raise ValueError("link_existing_uid verilmediyse password zorunludur")
        return self


class AdminUpdateRequest(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=128)
    email: str | None = Field(None, min_length=3, max_length=255)
    is_active: bool | None = None
    must_change_password: bool | None = None
    security_flags: dict[str, Any] | None = None


class AdminRoleAssignRequest(BaseModel):
    role_name: str = Field(..., min_length=1, max_length=128)


class AdminPublicFull(BaseModel):
    """Admin'in tam görünümü (admin yönetim sayfasında)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    display_name: str
    email: str
    is_active: bool
    mfa_enabled: bool
    ldap_dn: str | None = None
    must_change_password: bool
    password_changed_at: datetime | None = None
    last_login_at: datetime | None = None
    failed_login_count: int = 0
    locked_until: datetime | None = None
    security_flags: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)


class AdminListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[AdminPublicFull]



# ============================================================================
# Tur 10.2 — Var olan LDAP user'dan admin oluşturma için
# ============================================================================
class AvailableLdapUser(BaseModel):
    """ou=people altındaki LDAP user — admin yapılabilir."""
    uid: str
    display_name: str | None = None
    email: str | None = None
    dn: str


class AvailableLdapUsersResponse(BaseModel):
    items: list[AvailableLdapUser]
    total: int

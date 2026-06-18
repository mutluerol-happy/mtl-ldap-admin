# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""RBAC mutation şemaları (rol/permission CRUD)."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator


_ROLE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9._-]{1,62}[a-z0-9]$")
_PERM_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9._]{1,62}[a-z0-9]$")


def _validate_role_name(v: str) -> str:
    v = v.strip().lower()
    if not _ROLE_NAME_PATTERN.match(v):
        raise ValueError(
            "Rol adı 3-64 karakter, küçük harf/rakam/./_/-; harfle başlar (örn. mtl.helpdesk)"
        )
    return v


def _validate_perm_code(v: str) -> str:
    v = v.strip().lower()
    if not _PERM_CODE_PATTERN.match(v):
        raise ValueError("Permission code 3-64 karakter, küçük harf/rakam/./_ (örn. user.read)")
    return v


class RoleCreateRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=64, examples=["mtl.custom_role"])
    description: str | None = Field(None, max_length=512)
    requires_mfa: bool = Field(False)
    is_system: bool = Field(False, description="Sistem rolleri silinemez")
    permission_codes: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str) -> str:
        return _validate_role_name(v)

    @field_validator("permission_codes")
    @classmethod
    def _v_perms(cls, v: list[str]) -> list[str]:
        return [_validate_perm_code(p) for p in v]


class RoleUpdateRequest(BaseModel):
    description: str | None = Field(None, max_length=512)
    requires_mfa: bool | None = None


class PermissionCreateRequest(BaseModel):
    code: str = Field(..., min_length=3, max_length=64)
    module: str = Field(..., min_length=1, max_length=32)
    description: str | None = Field(None, max_length=512)

    @field_validator("code")
    @classmethod
    def _v(cls, v: str) -> str:
        return _validate_perm_code(v)


class RolePermissionLinkRequest(BaseModel):
    permission_code: str = Field(..., min_length=3, max_length=64)

    @field_validator("permission_code")
    @classmethod
    def _v(cls, v: str) -> str:
        return _validate_perm_code(v)

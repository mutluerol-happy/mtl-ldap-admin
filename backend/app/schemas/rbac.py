# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Role/Permission görüntüleme şemaları (Tur 3'te read-only)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PermissionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    module: str
    description: str | None = None


class RoleDetailPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    is_system: bool
    requires_mfa: bool
    permission_count: int = 0
    permissions: list[str] = Field(default_factory=list, description="Permission code'ları")


class RoleListResponse(BaseModel):
    total: int
    items: list[RoleDetailPublic]


class PermissionListResponse(BaseModel):
    total: int
    items: list[PermissionPublic]


class ModuleGroupedPermissions(BaseModel):
    module: str
    permissions: list[PermissionPublic]

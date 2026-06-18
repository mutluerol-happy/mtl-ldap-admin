# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Role/Permission görüntüleme servisi (Tur 3'te read-only)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError
from app.models.rbac import Permission, Role, RolePermission
from app.schemas.rbac import PermissionPublic, RoleDetailPublic


async def list_roles(db: AsyncSession, lang: str = "tr") -> list[RoleDetailPublic]:
    stmt = (
        select(Role)
        .options(
            selectinload(Role.permission_assignments)
            .selectinload(RolePermission.permission)
        )
        .order_by(Role.is_system.desc(), Role.name)
    )
    result = await db.execute(stmt)
    roles = result.scalars().all()
    return [
        RoleDetailPublic(
            id=r.id,
            name=r.name,
            description=(r.description_en or r.description) if lang == "en" else r.description,
            is_system=r.is_system,
            requires_mfa=r.requires_mfa,
            permission_count=len(r.permission_assignments),
            permissions=sorted(p.code for p in (pa.permission for pa in r.permission_assignments) if p),
        )
        for r in roles
    ]


async def get_role_by_name(db: AsyncSession, name: str, lang: str = "tr") -> RoleDetailPublic:
    stmt = (
        select(Role)
        .options(
            selectinload(Role.permission_assignments)
            .selectinload(RolePermission.permission)
        )
        .where(Role.name == name)
    )
    result = await db.execute(stmt)
    role = result.scalar_one_or_none()
    if role is None:
        raise NotFoundError(f"'{name}' rolü bulunamadı", code="ROLE_NOT_FOUND")
    return RoleDetailPublic(
        id=role.id,
        name=role.name,
        description=(role.description_en or role.description) if lang == "en" else role.description,
        is_system=role.is_system,
        requires_mfa=role.requires_mfa,
        permission_count=len(role.permission_assignments),
        permissions=sorted(p.code for p in (pa.permission for pa in role.permission_assignments) if p),
    )


async def list_permissions(db: AsyncSession) -> list[PermissionPublic]:
    stmt = select(Permission).order_by(Permission.module, Permission.code)
    result = await db.execute(stmt)
    return [
        PermissionPublic(
            id=p.id,
            code=p.code,
            module=p.module,
            description=p.description,
        )
        for p in result.scalars()
    ]


async def list_permissions_grouped(db: AsyncSession) -> list[dict[str, Any]]:
    """Module'a göre gruplanmış permission listesi."""
    perms = await list_permissions(db)
    grouped: dict[str, list[PermissionPublic]] = {}
    for p in perms:
        grouped.setdefault(p.module, []).append(p)
    return [{"module": m, "permissions": grouped[m]} for m in sorted(grouped.keys())]

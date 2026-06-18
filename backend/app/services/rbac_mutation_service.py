# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Rol/Permission CRUD servisi (Tur 4)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.models.rbac import Permission, Role, RolePermission
from app.schemas.rbac import RoleDetailPublic
from app.schemas.rbac_mutation import (
    PermissionCreateRequest,
    RoleCreateRequest,
    RoleUpdateRequest,
)
from app.services import rbac_service

logger = get_logger(__name__)


# ============================================================================
# Role CRUD
# ============================================================================


async def create_role(
    db: AsyncSession,
    payload: RoleCreateRequest,
    actor: UUID,
) -> RoleDetailPublic:
    # Çakışma kontrolü
    exists_stmt = select(Role).where(Role.name == payload.name)
    if (await db.execute(exists_stmt)).scalar_one_or_none() is not None:
        raise ConflictError(f"'{payload.name}' rolü zaten var", code="ROLE_EXISTS")

    role = Role(
        name=payload.name,
        description=payload.description,
        is_system=payload.is_system,
        requires_mfa=payload.requires_mfa,
    )
    db.add(role)
    await db.flush()

    # Permission bağla
    if payload.permission_codes:
        perm_stmt = select(Permission).where(Permission.code.in_(payload.permission_codes))
        perm_result = await db.execute(perm_stmt)
        perms = list(perm_result.scalars())
        found_codes = {p.code for p in perms}
        missing = set(payload.permission_codes) - found_codes
        if missing:
            raise ValidationError(
                f"Bilinmeyen permission code'lar: {sorted(missing)}",
                code="UNKNOWN_PERMISSIONS",
                details={"missing": sorted(missing)},
            )
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        await db.flush()

    logger.info("rbac.role_created", role=payload.name, actor=str(actor),
                permissions=len(payload.permission_codes))
    return await rbac_service.get_role_by_name(db, role.name)


async def update_role(
    db: AsyncSession,
    name: str,
    payload: RoleUpdateRequest,
    actor: UUID,
) -> RoleDetailPublic:
    stmt = select(Role).where(Role.name == name)
    role = (await db.execute(stmt)).scalar_one_or_none()
    if role is None:
        raise NotFoundError(f"'{name}' rolü bulunamadı", code="ROLE_NOT_FOUND")

    if role.is_system and payload.requires_mfa is not None and payload.requires_mfa != role.requires_mfa:
        raise ValidationError(
            "Sistem rolünde requires_mfa değiştirilemez",
            code="SYSTEM_ROLE_READONLY",
        )

    if payload.description is not None:
        role.description = payload.description
    if payload.requires_mfa is not None and not role.is_system:
        role.requires_mfa = payload.requires_mfa

    await db.flush()
    logger.info("rbac.role_updated", role=name, actor=str(actor))
    return await rbac_service.get_role_by_name(db, name)


async def delete_role(db: AsyncSession, name: str, actor: UUID) -> None:
    stmt = (
        select(Role)
        .options(selectinload(Role.permission_assignments))
        .where(Role.name == name)
    )
    role = (await db.execute(stmt)).scalar_one_or_none()
    if role is None:
        raise NotFoundError(f"'{name}' rolü bulunamadı", code="ROLE_NOT_FOUND")

    if role.is_system:
        raise ValidationError(
            "Sistem rolü silinemez",
            code="SYSTEM_ROLE_PROTECTED",
            details={"role": name},
        )

    # Bu rolü kullanan admin var mı?
    from app.models.admin import AdminRole
    using_stmt = select(AdminRole).where(AdminRole.role_id == role.id).limit(1)
    if (await db.execute(using_stmt)).scalar_one_or_none() is not None:
        raise ValidationError(
            f"'{name}' rolü atanmış admin'ler var, önce onları kaldırın",
            code="ROLE_IN_USE",
        )

    await db.delete(role)
    await db.flush()
    logger.info("rbac.role_deleted", role=name, actor=str(actor))


# ============================================================================
# Permission CRUD
# ============================================================================


async def create_permission(
    db: AsyncSession,
    payload: PermissionCreateRequest,
    actor: UUID,
) -> Permission:
    stmt = select(Permission).where(Permission.code == payload.code)
    if (await db.execute(stmt)).scalar_one_or_none() is not None:
        raise ConflictError(f"Permission '{payload.code}' zaten var", code="PERMISSION_EXISTS")

    perm = Permission(
        code=payload.code,
        module=payload.module,
        description=payload.description,
    )
    db.add(perm)
    await db.flush()
    logger.info("rbac.permission_created", code=payload.code, actor=str(actor))
    return perm


# ============================================================================
# Role↔Permission Link
# ============================================================================


async def add_permission_to_role(
    db: AsyncSession,
    role_name: str,
    permission_code: str,
    actor: UUID,
) -> RoleDetailPublic:
    r_stmt = select(Role).where(Role.name == role_name)
    role = (await db.execute(r_stmt)).scalar_one_or_none()
    if role is None:
        raise NotFoundError(f"'{role_name}' rolü yok", code="ROLE_NOT_FOUND")

    p_stmt = select(Permission).where(Permission.code == permission_code)
    perm = (await db.execute(p_stmt)).scalar_one_or_none()
    if perm is None:
        raise NotFoundError(f"Permission '{permission_code}' yok", code="PERMISSION_NOT_FOUND")

    exists_stmt = select(RolePermission).where(
        RolePermission.role_id == role.id,
        RolePermission.permission_id == perm.id,
    )
    if (await db.execute(exists_stmt)).scalar_one_or_none() is not None:
        return await rbac_service.get_role_by_name(db, role_name)  # idempotent

    db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    await db.flush()
    logger.info("rbac.permission_linked", role=role_name, permission=permission_code,
                actor=str(actor))
    return await rbac_service.get_role_by_name(db, role_name)


async def remove_permission_from_role(
    db: AsyncSession,
    role_name: str,
    permission_code: str,
    actor: UUID,
) -> RoleDetailPublic:
    r_stmt = select(Role).where(Role.name == role_name)
    role = (await db.execute(r_stmt)).scalar_one_or_none()
    if role is None:
        raise NotFoundError(f"'{role_name}' rolü yok", code="ROLE_NOT_FOUND")

    p_stmt = select(Permission).where(Permission.code == permission_code)
    perm = (await db.execute(p_stmt)).scalar_one_or_none()
    if perm is None:
        raise NotFoundError(f"Permission '{permission_code}' yok", code="PERMISSION_NOT_FOUND")

    link_stmt = select(RolePermission).where(
        RolePermission.role_id == role.id,
        RolePermission.permission_id == perm.id,
    )
    link = (await db.execute(link_stmt)).scalar_one_or_none()
    if link is None:
        return await rbac_service.get_role_by_name(db, role_name)  # idempotent

    await db.delete(link)
    await db.flush()
    logger.info("rbac.permission_unlinked", role=role_name, permission=permission_code,
                actor=str(actor))
    return await rbac_service.get_role_by_name(db, role_name)

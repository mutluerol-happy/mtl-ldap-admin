# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Admin hesap servisi (DB-resident admin'ler için).

Operasyonlar:
  - admin_by_username       : Login için
  - admin_by_id             : Token decode sonrası
  - is_locked / lock        : Brute force
  - register_failed_login   : Sayaç+lockout
  - register_success_login  : Sayaç sıfırla, last_login güncelle
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.admin import AdminAccount, AdminRole
from app.models.rbac import Role, RolePermission

logger = get_logger(__name__)

LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION = timedelta(minutes=15)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _admin_query_with_roles():
    """AdminAccount + roles + permissions eager-load."""
    return (
        select(AdminAccount)
        .options(
            selectinload(AdminAccount.role_assignments)
            .selectinload(AdminRole.role)
            .selectinload(Role.permission_assignments)
            .selectinload(RolePermission.permission)
        )
    )


async def get_admin_by_username(db: AsyncSession, username: str) -> AdminAccount | None:
    """username case-insensitive ara."""
    stmt = _admin_query_with_roles().where(
        AdminAccount.username == username.strip().lower()
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_admin_by_id(db: AsyncSession, admin_id: UUID) -> AdminAccount | None:
    stmt = _admin_query_with_roles().where(AdminAccount.id == admin_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


def is_locked(admin: AdminAccount) -> bool:
    """Şu an kilitli mi? (locked_until geçmişse False)"""
    if admin.locked_until is None:
        return False
    return admin.locked_until > _now()


async def register_failed_login(db: AsyncSession, admin: AdminAccount) -> bool:
    """
    Başarısız sayacı +1, threshold'a ulaşırsa kilitle.

    Returns:
        True = artık kilitli.
    """
    admin.failed_login_count = (admin.failed_login_count or 0) + 1
    locked_now = False

    if admin.failed_login_count >= LOCKOUT_THRESHOLD:
        admin.locked_until = _now() + LOCKOUT_DURATION
        locked_now = True
        logger.warning(
            "admin.locked",
            username=admin.username,
            failed_count=admin.failed_login_count,
            until=admin.locked_until.isoformat(),
        )
    await db.flush()
    return locked_now or is_locked(admin)


async def register_successful_login(
    db: AsyncSession,
    admin: AdminAccount,
) -> None:
    admin.failed_login_count = 0
    admin.locked_until = None
    admin.last_login_at = _now()
    await db.flush()


def get_admin_permissions(admin: AdminAccount) -> set[str]:
    perms: set[str] = set()
    for ar in admin.role_assignments:
        if ar.role and ar.role.permission_assignments:
            for rp in ar.role.permission_assignments:
                if rp.permission:
                    perms.add(rp.permission.code)
    return perms


def get_admin_roles(admin: AdminAccount) -> list[Role]:
    return [ar.role for ar in admin.role_assignments if ar.role]


def admin_requires_mfa(admin: AdminAccount) -> bool:
    """Rollerden herhangi biri MFA zorunlu kılıyor mu?"""
    return any(ar.role.requires_mfa for ar in admin.role_assignments if ar.role)

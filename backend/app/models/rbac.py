# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
RBAC modelleri — gerçek SQL şemasına göre.

mtl_core.role           : ad bazlı rol
mtl_core.permission     : code + module
mtl_core.role_permission: cross (composite PK)
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPKMixin


class Permission(Base, UUIDPKMixin):
    """
    Tablo: mtl_core.permission
    Kolonlar: id, code, module, description
    """

    __tablename__ = "permission"
    __table_args__ = ({"schema": "mtl_core"},)

    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    module: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<Permission {self.code}>"


class Role(Base, UUIDPKMixin):
    """
    Tablo: mtl_core.role
    Kolonlar: id, name, description, is_system, created_at

    NOT: SQL'de 'code' kolonu yok — name = code olarak kullanılır.
    requires_mfa kolonu da yok; uygulama tarafında is_system ve name'e
    bakılarak MFA zorunluluğu çıkartılır.
    """

    __tablename__ = "role"
    __table_args__ = ({"schema": "mtl_core"},)

    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    permission_assignments: Mapped[list["RolePermission"]] = relationship(
        back_populates="role",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # MFA zorunluluğu — sistem rolünde admin/super_admin/security_admin vb. zorunlu
    # Hem mevcut SQL şemasındaki (mtl.X) hem eski/sade (X) adları destekler
    MFA_REQUIRED_ROLES: tuple[str, ...] = (
        # SQL şeması seed adları
        "mtl.super_admin",
        "mtl.identity_manager",
        "mtl.security_officer",
        "mtl.infra_operator",
        # Sade/eski adlar (fallback)
        "super_admin",
        "admin",
        "security_admin",
        "user_admin",
        "group_admin",
    )

    @property
    def requires_mfa(self) -> bool:
        return self.is_system and self.name in self.MFA_REQUIRED_ROLES

    @property
    def code(self) -> str:
        """Geri-uyumluluk: bazı kodlar role.code bekliyor."""
        return self.name

    def __repr__(self) -> str:
        return f"<Role {self.name}>"


class RolePermission(Base):
    """
    Composite PK tablo (role_id + permission_id).

    Tablo: mtl_core.role_permission
    """

    __tablename__ = "role_permission"
    __table_args__ = ({"schema": "mtl_core"},)

    role_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.role.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.permission.id", ondelete="CASCADE"),
        primary_key=True,
    )

    role: Mapped["Role"] = relationship(back_populates="permission_assignments")
    permission: Mapped["Permission"] = relationship(lazy="joined")

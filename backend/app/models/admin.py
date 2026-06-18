# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Admin hesap modelleri (Tur 3 genişletilmiş).

mtl_core.admin_account — yönetim konsolu admin'leri.
  - DB-resident (username, password_hash, mfa_secret_encrypted)
  - Tur 3 eklemeleri: ldap_dn, security_flags, must_change_password, password_changed_at

Admin'ler aynı zamanda LDAP'te de ou=admins,dc=mtl,dc=local altında bulunur.
ldap_dn kolonu bu eşleştirmeyi tutar.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPKMixin

if TYPE_CHECKING:
    from app.models.rbac import Role


class AdminAccount(Base, UUIDPKMixin):
    """Tablo: mtl_core.admin_account"""

    __tablename__ = "admin_account"
    __table_args__ = ({"schema": "mtl_core"},)

    # === Temel kimlik ===
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)

    # === MFA ===
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mfa_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    # === Hesap durumu ===
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # === Tur 3 eklemeleri ===
    ldap_dn: Mapped[str | None] = mapped_column(Text, nullable=True)
    security_flags: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # === Timestamps ===
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # İlişkiler
    role_assignments: Mapped[list["AdminRole"]] = relationship(
        back_populates="admin",
        cascade="all, delete-orphan",
        lazy="selectin",
        foreign_keys="AdminRole.admin_id",
    )

    def __repr__(self) -> str:
        return f"<AdminAccount username={self.username} active={self.is_active}>"


class AdminRole(Base):
    """Tablo: mtl_core.admin_role (composite PK: admin_id, role_id)"""

    __tablename__ = "admin_role"
    __table_args__ = ({"schema": "mtl_core"},)

    admin_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.admin_account.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.role.id", ondelete="CASCADE"),
        primary_key=True,
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    admin: Mapped["AdminAccount"] = relationship(
        back_populates="role_assignments",
        foreign_keys=[admin_id],
    )
    role: Mapped["Role"] = relationship(lazy="joined")

# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
LDAP end-user'lar için DB-side metadata tablosu.

LDAP source-of-truth, ama:
  - Failed login counter (DB)
  - Lockout durumu (DB)
  - Audit (DB)
  - MFA flag cache (DB ↔ LDAP sync)

Aslında çift kaynak, periyodik sync ile tutarlılık.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class UserMetadata(Base, UUIDPKMixin):
    """Tablo: mtl_core.user_metadata"""

    __tablename__ = "user_metadata"
    __table_args__ = (
        UniqueConstraint("ldap_uid", name="uq_user_metadata_ldap_uid"),
        CheckConstraint(
            "ldap_sync_status IN ('in_sync', 'drift', 'orphan_db', 'orphan_ldap')",
            name="ck_user_metadata_sync_status",
        ),
        Index("ix_user_metadata_email_partial", "email"),
        Index("ix_user_metadata_is_active", "is_active"),
        Index("ix_user_metadata_last_login_at", "last_login_at"),
        Index("ix_user_metadata_ldap_sync_status", "ldap_sync_status"),
        {"schema": "mtl_core"},
    )

    ldap_uid: Mapped[str] = mapped_column(Text, nullable=False)
    ldap_dn: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Hesap durumu
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Parola
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # MFA cache
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mfa_enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mfa_last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Login geçmişi
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    last_login_user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Esnek bayraklar
    security_flags: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    # Audit alanları
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.admin_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.admin_account.id", ondelete="SET NULL"),
        nullable=True,
    )

    # LDAP sync
    ldap_last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ldap_sync_status: Mapped[str] = mapped_column(Text, nullable=False, default="in_sync")

    def __repr__(self) -> str:
        return f"<UserMetadata uid={self.ldap_uid} active={self.is_active}>"

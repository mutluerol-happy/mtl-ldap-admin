# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""LDAP ↔ DB sync tutarsızlık kayıtları."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class SyncDiscrepancy(Base, UUIDPKMixin):
    """Tablo: mtl_core.sync_discrepancy"""

    __tablename__ = "sync_discrepancy"
    __table_args__ = (
        CheckConstraint(
            "discrepancy_type IN ('orphan_db','orphan_ldap','attribute_drift','mfa_flag_drift')",
            name="ck_sync_discrepancy_type",
        ),
        CheckConstraint(
            "subject_type IN ('ADMIN','END_USER')",
            name="ck_sync_discrepancy_subject",
        ),
        Index("ix_sync_discrepancy_unresolved", "discovered_at"),
        Index("ix_sync_discrepancy_type", "discrepancy_type", "discovered_at"),
        {"schema": "mtl_core"},
    )

    discovered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    discrepancy_type: Mapped[str] = mapped_column(Text, nullable=False)
    subject_type: Mapped[str] = mapped_column(Text, nullable=False)
    subject_id: Mapped[str] = mapped_column(Text, nullable=False)
    ldap_dn: Mapped[str | None] = mapped_column(Text, nullable=True)
    db_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    diff_details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.admin_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolution_action: Mapped[str | None] = mapped_column(Text, nullable=True)

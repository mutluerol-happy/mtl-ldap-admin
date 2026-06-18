# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Alert engine: kural + tetiklenen event tabloları."""

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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class AlertRule(Base, UUIDPKMixin):
    """Tablo: mtl_alert.rule"""

    __tablename__ = "rule"
    __table_args__ = (
        UniqueConstraint("rule_code", name="uq_alert_rule_code"),
        CheckConstraint(
            "severity IN ('INFO','NOTICE','WARNING','ERROR','CRITICAL')",
            name="ck_alert_rule_severity",
        ),
        CheckConstraint(
            "rule_type IN ('FAILED_LOGIN_SPIKE','ACCOUNT_LOCKOUT_BURST',"
            "'MFA_BYPASS_ATTEMPT','PRIVILEGE_ESCALATION','ADMIN_CREATED',"
            "'ROLE_ASSIGNED','BULK_DELETE','CUSTOM')",
            name="ck_alert_rule_type",
        ),
        Index("ix_alert_rule_enabled", "enabled", "rule_type"),
        {"schema": "mtl_alert"},
    )

    rule_code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    name_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(Text, nullable=False, default="WARNING")
    rule_type: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    threshold_count: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    window_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    notify_channels: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    extra_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AlertEvent(Base, UUIDPKMixin):
    """Tablo: mtl_alert.event — tetiklenen alarm."""

    __tablename__ = "event"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open','acknowledged','resolved','suppressed')",
            name="ck_alert_event_status",
        ),
        Index("ix_alert_event_status", "status", "triggered_at"),
        Index("ix_alert_event_rule", "rule_id", "triggered_at"),
        Index("ix_alert_event_severity", "severity", "status"),
        {"schema": "mtl_alert"},
    )

    rule_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_alert.rule.id", ondelete="CASCADE"),
        nullable=False,
    )
    triggered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    severity: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    matched_events: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    window_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    window_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[str] = mapped_column(Text, nullable=False, default="open")
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.admin_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.admin_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    extra_details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

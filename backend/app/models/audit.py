# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Audit model — mtl_audit.event_log

Tek tablo, tüm event'ler için. SQL şemasında:
  - actor_type ∈ {ADMIN, END_USER, SERVICE, SYSTEM}
  - severity  ∈ {INFO, NOTICE, WARNING, ERROR, CRITICAL}
  - category  : SECURITY, USER, GROUP, AUDIT, SYSTEM, ...
  - event_code: LOGIN_SUCCESS, LOGIN_FAILED, USER_CREATED, ...

Trigger 'trg_audit_no_modify' UPDATE/DELETE engelliyor — append-only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EventLog(Base):
    """
    Tablo: mtl_audit.event_log
    """

    __tablename__ = "event_log"
    __table_args__ = ({"schema": "mtl_audit"},)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    server_node: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    event_code: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(Text, nullable=False, default="INFO")
    actor_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_display: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_display: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    country_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

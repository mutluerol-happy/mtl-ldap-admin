# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Bulk import job tablosu."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class BulkImportJob(Base, UUIDPKMixin):
    """Tablo: mtl_core.bulk_import_job"""

    __tablename__ = "bulk_import_job"
    __table_args__ = (
        CheckConstraint(
            "job_type IN ('user_create', 'user_update', 'group_create', 'group_membership')",
            name="ck_bulk_import_job_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', 'partial', 'cancelled')",
            name="ck_bulk_import_job_status",
        ),
        CheckConstraint(
            "source_format IS NULL OR source_format IN ('csv', 'json', 'ldif')",
            name="ck_bulk_import_job_format",
        ),
        Index("ix_bulk_import_job_initiated_by", "initiated_by"),
        Index("ix_bulk_import_job_status", "status", "queued_at"),
        {"schema": "mtl_core"},
    )

    job_type: Mapped[str] = mapped_column(Text, nullable=False)
    initiated_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.admin_account.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")

    total_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    source_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_format: Mapped[str | None] = mapped_column(Text, nullable=True)

    result_summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error_log: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)

    queued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(Text, nullable=True)

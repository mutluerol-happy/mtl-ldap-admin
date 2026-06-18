# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Cluster node ve sync queue tabloları."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class ClusterNode(Base, UUIDPKMixin):
    """Tablo: mtl_cluster.node"""

    __tablename__ = "node"
    __table_args__ = (
        UniqueConstraint("node_id", name="uq_cluster_node_id"),
        CheckConstraint("node_type IN ('MASTER','SLAVE')", name="ck_cluster_node_type"),
        CheckConstraint(
            "status IN ('online','offline','degraded','unknown','syncing')",
            name="ck_cluster_node_status",
        ),
        Index("ix_cluster_node_status", "status"),
        {"schema": "mtl_cluster"},
    )

    node_id: Mapped[str] = mapped_column(Text, nullable=False)
    node_type: Mapped[str] = mapped_column(Text, nullable=False)
    hostname: Mapped[str] = mapped_column(Text, nullable=False)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="unknown")
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_context_csn: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SyncQueue(Base, UUIDPKMixin):
    """Tablo: mtl_cluster.sync_queue — retry queue."""

    __tablename__ = "sync_queue"
    __table_args__ = (
        CheckConstraint(
            "payload_type IN ('AUDIT_EVENT','CONFIG_SYNC','CLUSTER_MESSAGE')",
            name="ck_sync_queue_payload_type",
        ),
        CheckConstraint(
            "status IN ('pending','sent','failed','abandoned')",
            name="ck_sync_queue_status",
        ),
        Index("ix_sync_queue_target", "target_node_id", "status"),
        {"schema": "mtl_cluster"},
    )

    target_node_id: Mapped[str] = mapped_column(Text, nullable=False)
    payload_type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    queued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProvisionToken(Base, UUIDPKMixin):
    """Tablo: mtl_cluster.provision_token — tek-kullanimlik consumer provision token."""

    __tablename__ = "provision_token"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_provision_token_hash"),
        Index("ix_provision_token_expires", "expires_at"),
        {"schema": "mtl_cluster"},
    )

    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    node_id: Mapped[str] = mapped_column(Text, nullable=False)
    payload_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

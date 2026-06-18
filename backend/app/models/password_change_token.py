# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Password change token — must_change_password login flow için."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class PasswordChangeToken(Base, UUIDPKMixin):
    """Tablo: mtl_core.password_change_token"""

    __tablename__ = "password_change_token"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_pwd_change_token_hash"),
        Index("ix_pwd_change_token_expires", "expires_at"),
        {"schema": "mtl_core"},
    )

    admin_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mtl_core.admin_account.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    issued_user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

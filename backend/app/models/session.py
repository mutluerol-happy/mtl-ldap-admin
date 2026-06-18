# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
mtl_core.session — Refresh token storage.

JWT yerine (veya yanında) bu tablo da refresh session'ları takip eder.
Redis blacklist'e ek olarak DB-level revoke için kullanılabilir.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text, func
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class Session(Base, UUIDPKMixin):
    """Tablo: mtl_core.session"""

    __tablename__ = "session"
    __table_args__ = ({"schema": "mtl_core"},)

    subject_type: Mapped[str] = mapped_column(Text, nullable=False)  # ADMIN | END_USER
    subject_id: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    country_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

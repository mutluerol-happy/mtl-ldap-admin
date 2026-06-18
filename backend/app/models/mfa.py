# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
mtl_core.mfa_pending_enrollment — TOTP setup henüz verify edilmemiş kayıtlar.

Setup → secret üretilir, encrypted olarak buraya kaydedilir.
Verify → kayıt silinir, secret admin_account.mfa_secret_encrypted'a taşınır.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class MfaPendingEnrollment(Base, UUIDPKMixin):
    """Tablo: mtl_core.mfa_pending_enrollment"""

    __tablename__ = "mfa_pending_enrollment"
    __table_args__ = ({"schema": "mtl_core"},)

    subject_type: Mapped[str] = mapped_column(Text, nullable=False)  # ADMIN | END_USER
    subject_id: Mapped[str] = mapped_column(Text, nullable=False)
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

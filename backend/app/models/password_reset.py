# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Slave-side parola reset talep modelleri."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class PasswordResetRequest(Base, UUIDPKMixin):
    """Tablo: mtl_core.password_reset_request"""

    __tablename__ = "password_reset_request"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','verified','completed','expired','cancelled','locked')",
            name="ck_pwd_reset_status",
        ),
        Index("ix_pwd_reset_target_uid", "target_uid", "issued_at"),
        Index("ix_pwd_reset_status_expires", "status", "expires_at"),
        {"schema": "mtl_core"},
    )

    target_uid: Mapped[str] = mapped_column(Text, nullable=False)
    target_email: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_ldap_dn: Mapped[str | None] = mapped_column(Text, nullable=True)
    otp_hash: Mapped[str] = mapped_column(Text, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completion_token_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    completion_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    request_ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    request_user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")


class UserSelfServiceLog(Base, UUIDPKMixin):
    """Tablo: mtl_core.user_self_service_log — end_user kendi işlemleri."""

    __tablename__ = "user_self_service_log"
    __table_args__ = (
        Index("ix_user_ss_log_uid", "target_uid", "occurred_at"),
        Index("ix_user_ss_log_event", "event_code", "occurred_at"),
        {"schema": "mtl_core"},
    )

    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    event_code: Mapped[str] = mapped_column(Text, nullable=False)
    target_uid: Mapped[str] = mapped_column(Text, nullable=False)
    target_email: Mapped[str | None] = mapped_column(Text, nullable=True)
    successful: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class EndUserMfaSecret(Base, UUIDPKMixin):
    """Tablo: mtl_core.end_user_mfa_secret"""

    __tablename__ = "end_user_mfa_secret"
    __table_args__ = (
        UniqueConstraint("target_uid", name="uq_end_user_mfa_uid"),
        {"schema": "mtl_core"},
    )

    target_uid: Mapped[str] = mapped_column(Text, nullable=False)
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recovery_codes_hash: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

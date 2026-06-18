# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""System settings model — key/value yapılandırma."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class SystemSetting(Base, UUIDPKMixin):
    """Tablo: mtl_core.system_setting

    Yapılandırma key/value deposu. Hassas değerler (smtp.password gibi)
    `encrypted_value` alanında Fernet ile şifrelenir; normal değerler
    `value` alanında düz metin tutulur.

    value_type: string | integer | boolean | json
    """

    __tablename__ = "system_setting"
    __table_args__ = (
        UniqueConstraint("category", "key", name="system_setting_category_key_unique"),
        {"schema": "mtl_core"},
    )

    category: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_type: Mapped[str] = mapped_column(Text, nullable=False)
    is_sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_editable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    updated_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)

    def __repr__(self) -> str:
        return f"<SystemSetting {self.category}.{self.key}>"

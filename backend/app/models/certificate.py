# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Sertifika envanteri + CSR tabloları (Tur 14 — shield).

certificate_inventory: TLS sertifika kataloğu. pem_data SADECE public sertifikayı
tutar; özel anahtarlar diskte (/etc/mtl/ssl), DB'de DEĞİL.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class CertificateInventory(Base, UUIDPKMixin):
    """Tablo: mtl_core.certificate_inventory"""

    __tablename__ = "certificate_inventory"
    __table_args__ = (
        CheckConstraint("type IN ('SERVER','CA','CLIENT')", name="certificate_inventory_type_check"),
        CheckConstraint(
            "source IN ('UPLOAD','GENERATED','INSTALLER','RESIGNED')",
            name="ck_certificate_inventory_source",
        ),
        Index("idx_cert_active", "is_active"),
        Index("idx_cert_expiry", "not_after"),
        {"schema": "mtl_core"},
    )

    name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    pem_data: Mapped[str] = mapped_column(Text, nullable=False)
    serial_number: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    issuer: Mapped[str] = mapped_column(Text, nullable=False)
    not_before: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    not_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fingerprint_sha256: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Tur 14 eklentileri
    has_private_key: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False, default="UPLOAD")
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    activated_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    # İskeletten gelen
    uploaded_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<CertificateInventory {self.type} {self.name} active={self.is_active}>"


class CertificateSigningRequest(Base, UUIDPKMixin):
    """Tablo: mtl_core.certificate_signing_request

    Panel üretimli CSR. Özel anahtar diskte (key_path), DB'de DEĞİL.
    """

    __tablename__ = "certificate_signing_request"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING','FULFILLED','CANCELLED')", name="ck_csr_status"
        ),
        Index("idx_csr_status", "status"),
        {"schema": "mtl_core"},
    )

    name: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    csr_pem: Mapped[str] = mapped_column(Text, nullable=False)
    key_path: Mapped[str] = mapped_column(Text, nullable=False)
    key_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="PENDING")
    fulfilled_cert_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<CertificateSigningRequest {self.name} status={self.status}>"

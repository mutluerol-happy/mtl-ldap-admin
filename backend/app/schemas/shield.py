# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Shield (sertifika/TLS) şemaları."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ============================================================================
# Sertifika
# ============================================================================
class CertificatePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: str  # SERVER | CA | CLIENT
    serial_number: str
    subject: str
    issuer: str
    not_before: datetime
    not_after: datetime
    fingerprint_sha256: str
    is_active: bool
    has_private_key: bool
    description: str | None = None
    source: str
    activated_at: datetime | None = None
    uploaded_at: datetime
    # türetilmiş alanlar (servis dolduruyor)
    days_remaining: int | None = None
    is_expired: bool | None = None
    is_self_signed: bool | None = None


class CertificateDetail(CertificatePublic):
    """Tek sertifika detayı — PEM dahil."""

    pem_data: str


class CertificateUploadRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    type: Literal["SERVER", "CA", "CLIENT"]
    pem: str = Field(..., min_length=64, description="Public sertifika PEM")
    private_key: str | None = Field(
        None, description="SERVER tipi için özel anahtar PEM (diskte 600 saklanır, DB'ye girmez)"
    )
    csr_id: UUID | None = Field(
        None,
        description="Panel üretimli CSR'ı karşılarken: anahtar diskteki CSR kaydından alınır (private_key gerekmez)",
    )
    description: str | None = Field(None, max_length=512)


class CertificateActivateResponse(BaseModel):
    certificate: CertificatePublic
    slapd_reloaded: bool
    nginx_reloaded: bool
    ca_trust_updated: bool
    live_ldaps_fingerprint: str | None = None
    live_https_fingerprint: str | None = None
    message: str
    # CA değişiminde replikasyon uyarısı
    replication_warning: str | None = None


# ============================================================================
# Genel bakış (overview)
# ============================================================================
class LiveEndpointStatus(BaseModel):
    name: str  # "ldaps" | "https"
    host: str
    port: int
    reachable: bool
    fingerprint_sha256: str | None = None
    matches_active: bool | None = None  # canlı cert == aktif SERVER cert mi?
    error: str | None = None


class ShieldOverview(BaseModel):
    active_ca: CertificatePublic | None = None
    active_server: CertificatePublic | None = None
    total_certificates: int
    pending_csr: int
    endpoints: list[LiveEndpointStatus]
    # uyarılar
    warnings: list[str] = Field(default_factory=list)


# ============================================================================
# CSR
# ============================================================================
class CsrGenerateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    common_name: str = Field(..., min_length=1, max_length=255, description="CN — örn. mtl-master-01.mtl.local")
    organization: str = Field("MTL", max_length=128)
    country: str = Field("TR", min_length=2, max_length=2)
    san_dns: list[str] = Field(default_factory=list, description="Ek DNS SAN'ları")
    san_ip: list[str] = Field(default_factory=list, description="Ek IP SAN'ları")
    key_bits: Literal[2048, 4096] = 4096


class CsrPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    subject: str
    status: str
    key_fingerprint: str | None = None
    fulfilled_cert_id: UUID | None = None
    created_at: datetime
    fulfilled_at: datetime | None = None


class CsrGenerateResponse(BaseModel):
    csr: CsrPublic
    csr_pem: str  # indirilebilir CSR metni


# ============================================================================
# CA geçişi / dışa aktarım
# ============================================================================
class CaExportResponse(BaseModel):
    name: str
    pem: str
    fingerprint_sha256: str
    subject: str
    not_after: datetime
    # slave dağıtımı için bilgi
    note: str


class CaResignRequest(BaseModel):
    """Mevcut bir CSR'ı VEYA serbest CN'i MTL CA ile imzala (geçiş/test için)."""

    csr_id: UUID | None = Field(None, description="Panel üretimli CSR id (varsa)")
    name: str = Field(..., min_length=1, max_length=128)
    description: str | None = Field(None, max_length=512)
    days: int = Field(1825, ge=1, le=3650)


class TransitionActivateRequest(BaseModel):
    """CA geçişi: yeni CA + yeni server sertifikasını ATOMİK aktive et.

    server cert, ca'ya zincirlenmeli; helper bunu doğrular, başarısızsa rollback yapar.
    """

    ca_id: UUID = Field(..., description="Aktive edilecek CA sertifikası (envanter id)")
    server_id: UUID = Field(..., description="Aktive edilecek SERVER sertifikası (envanter id)")

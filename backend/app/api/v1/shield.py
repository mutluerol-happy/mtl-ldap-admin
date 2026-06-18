# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Shield (Sertifika/TLS) endpoint'leri — yalnızca master.

  GET    /shield/overview                      shield.cert.read
  GET    /shield/certificates                  shield.cert.read
  GET    /shield/certificates/{id}             shield.cert.read
  POST   /shield/certificates                  shield.cert.upload
  DELETE /shield/certificates/{id}             shield.cert.delete
  POST   /shield/certificates/{id}/activate    shield.cert.activate
  GET    /shield/csr                           shield.cert.read
  POST   /shield/csr                           shield.cert.upload
  POST   /shield/csr/{id}/resign               shield.cert.upload
  GET    /shield/ca/export                     shield.cert.read
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentAdmin, DbSession, get_request_meta, require_permission
from app.core.logging import get_logger
from app.schemas.shield import (
    CaExportResponse,
    CaResignRequest,
    CertificateActivateResponse,
    CertificateDetail,
    CertificatePublic,
    CertificateUploadRequest,
    CsrGenerateRequest,
    CsrGenerateResponse,
    CsrPublic,
    ShieldOverview,
    TransitionActivateRequest,
)
from app.services import audit_service, shield_service

logger = get_logger(__name__)

router = APIRouter(prefix="/shield", tags=["shield"])


# ---------------------------------------------------------------------------
# Genel bakış
# ---------------------------------------------------------------------------
@router.get("/overview", response_model=ShieldOverview, summary="Sertifika/TLS genel bakış")
async def overview(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("shield.cert.read"))],
) -> ShieldOverview:
    data = await shield_service.get_overview(db)
    return ShieldOverview(**data)


# ---------------------------------------------------------------------------
# Sertifika listesi / detay
# ---------------------------------------------------------------------------
@router.get("/certificates", response_model=list[CertificatePublic], summary="Sertifika envanteri")
async def list_certificates(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("shield.cert.read"))],
) -> list[CertificatePublic]:
    rows = await shield_service.list_certificates(db)
    return [CertificatePublic(**r) for r in rows]


@router.get("/certificates/{cert_id}", response_model=CertificateDetail, summary="Sertifika detayı (PEM dahil)")
async def get_certificate(
    cert_id: UUID,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("shield.cert.read"))],
) -> CertificateDetail:
    cert = await shield_service.get_certificate(db, cert_id)
    payload = shield_service._to_public(cert)
    payload["pem_data"] = cert.pem_data
    return CertificateDetail(**payload)


# ---------------------------------------------------------------------------
# Yükleme
# ---------------------------------------------------------------------------
@router.post(
    "/certificates",
    response_model=CertificatePublic,
    status_code=status.HTTP_201_CREATED,
    summary="Sertifika yükle (CA veya SERVER+anahtar)",
)
async def upload_certificate(
    payload: CertificateUploadRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("shield.cert.upload"))],
) -> CertificatePublic:
    cert = await shield_service.upload_certificate(
        db,
        name=payload.name,
        cert_type=payload.type,
        pem=payload.pem,
        private_key=payload.private_key,
        csr_id=payload.csr_id,
        description=payload.description,
        admin_id=current.id,
    )
    await audit_service.log_event(
        db,
        category="ADMIN",
        event_code="CERT_UPLOADED",
        severity="NOTICE",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="CERTIFICATE",
        target_id=str(cert.id),
        target_display=f"{cert.type}:{cert.name}",
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={"type": cert.type, "fingerprint": cert.fingerprint_sha256, "subject": cert.subject},
    )
    await db.commit()
    return CertificatePublic(**shield_service._to_public(cert))


# ---------------------------------------------------------------------------
# Silme
# ---------------------------------------------------------------------------
@router.delete(
    "/certificates/{cert_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Sertifika sil (aktif olmayan)",
)
async def delete_certificate(
    cert_id: UUID,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("shield.cert.delete"))],
):
    cert = await shield_service.delete_certificate(db, cert_id)
    await audit_service.log_event(
        db,
        category="ADMIN",
        event_code="CERT_DELETED",
        severity="WARNING",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="CERTIFICATE",
        target_id=str(cert_id),
        target_display=f"{cert.type}:{cert.name}",
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={"fingerprint": cert.fingerprint_sha256},
    )
    await db.commit()
    from fastapi.responses import Response

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Aktivasyon
# ---------------------------------------------------------------------------
@router.post(
    "/certificates/{cert_id}/activate",
    response_model=CertificateActivateResponse,
    summary="Sertifikayı aktive et (canlı swap + slapd/nginx reload + doğrula)",
)
async def activate_certificate(
    cert_id: UUID,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("shield.cert.activate"))],
) -> CertificateActivateResponse:
    # Aktivasyon helper'ı çağırır; başarısızsa ValidationError → 400, DB değişmez.
    result = await shield_service.activate_certificate(db, cert_id, current.id)
    await audit_service.log_event(
        db,
        category="ADMIN",
        event_code="CERT_ACTIVATED",
        severity="WARNING",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="CERTIFICATE",
        target_id=str(cert_id),
        target_display=result["certificate"]["name"],
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={
            "type": result["certificate"]["type"],
            "slapd_reloaded": result["slapd_reloaded"],
            "nginx_reloaded": result["nginx_reloaded"],
            "ca_trust_updated": result["ca_trust_updated"],
        },
    )
    await db.commit()
    return CertificateActivateResponse(**result)


# ---------------------------------------------------------------------------
# CSR
# ---------------------------------------------------------------------------
@router.get("/csr", response_model=list[CsrPublic], summary="CSR listesi")
async def list_csr(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("shield.cert.read"))],
) -> list[CsrPublic]:
    rows = await shield_service.list_csr(db)
    return [CsrPublic.model_validate(r) for r in rows]


@router.post(
    "/csr",
    response_model=CsrGenerateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="CSR üret (anahtar master'da kalır)",
)
async def generate_csr(
    payload: CsrGenerateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("shield.cert.upload"))],
) -> CsrGenerateResponse:
    csr, csr_pem = await shield_service.generate_csr(db, payload.model_dump(), current.id)
    await audit_service.log_event(
        db,
        category="ADMIN",
        event_code="CSR_GENERATED",
        severity="NOTICE",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="CSR",
        target_id=str(csr.id),
        target_display=csr.name,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={"subject": csr.subject},
    )
    await db.commit()
    return CsrGenerateResponse(csr=CsrPublic.model_validate(csr), csr_pem=csr_pem)


@router.post(
    "/csr/{csr_id}/resign",
    response_model=CertificatePublic,
    status_code=status.HTTP_201_CREATED,
    summary="CSR'ı MTL CA ile yeniden imzala (geçiş/test)",
)
async def resign_csr(
    csr_id: UUID,
    payload: CaResignRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("shield.cert.upload"))],
) -> CertificatePublic:
    cert = await shield_service.resign_csr_with_mtl_ca(
        db,
        csr_id=csr_id,
        name=payload.name,
        description=payload.description,
        days=payload.days,
        admin_id=current.id,
    )
    await audit_service.log_event(
        db,
        category="ADMIN",
        event_code="CERT_RESIGNED",
        severity="NOTICE",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="CERTIFICATE",
        target_id=str(cert.id),
        target_display=cert.name,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={"csr_id": str(csr_id)},
    )
    await db.commit()
    return CertificatePublic(**shield_service._to_public(cert))


# ---------------------------------------------------------------------------
# CA geçişi (atomik CA + SERVER)
# ---------------------------------------------------------------------------
@router.post(
    "/transition/activate",
    response_model=CertificateActivateResponse,
    summary="CA geçişi: yeni CA + SERVER sertifikasını atomik aktive et",
)
async def transition_activate(
    payload: TransitionActivateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("shield.cert.activate"))],
) -> CertificateActivateResponse:
    result = await shield_service.activate_bundle(
        db, ca_id=payload.ca_id, server_id=payload.server_id, admin_id=current.id
    )
    await audit_service.log_event(
        db,
        category="ADMIN",
        event_code="CERT_TRANSITION_ACTIVATED",
        severity="WARNING",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="CERTIFICATE",
        target_id=str(payload.server_id),
        target_display=result["certificate"]["name"],
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={"ca_id": str(payload.ca_id), "server_id": str(payload.server_id)},
    )
    await db.commit()
    return CertificateActivateResponse(**result)


# ---------------------------------------------------------------------------
# CA dışa aktarım (slave dağıtımı için)
# ---------------------------------------------------------------------------
@router.get("/ca/export", response_model=CaExportResponse, summary="Aktif CA'yı dışa aktar (slave için)")
async def export_ca(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("shield.cert.read"))],
) -> CaExportResponse:
    data = await shield_service.export_active_ca(db)
    return CaExportResponse(**data)

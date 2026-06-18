# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""LDAP ↔ DB sync endpoint'leri (admin only)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response

from app.api.deps import (
    CurrentAdmin,
    DbSession,
    get_request_meta,
    require_permission,
)
from app.core.logging import get_logger
from app.schemas.sync import SyncResolveRequest, SyncStatusSummary
from app.services import audit_service, sync_service

logger = get_logger(__name__)

router = APIRouter(prefix="/admin", tags=["sync"])


@router.get(
    "/sync-status",
    response_model=SyncStatusSummary,
    summary="LDAP↔DB sync durumu özeti (çözülmemiş tutarsızlıklar dahil)",
)
async def get_sync_status(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> SyncStatusSummary:
    status_data = await sync_service.get_sync_status(db)
    return SyncStatusSummary(**status_data)


@router.post(
    "/sync-scan",
    summary="LDAP↔DB tam taraması başlat (senkron çalışır, ~1-5 saniye küçük dizinler için)",
)
async def trigger_sync_scan(
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> dict:
    result = await sync_service.scan_user_sync(db)
    await audit_service.log_event(
        db, category="SECURITY", event_code="SYNC_SCAN_TRIGGERED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details=result,
    )
    await db.commit()
    return result


@router.post(
    "/sync-resolve",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Bir sync tutarsızlığını çöz",
)
async def resolve_sync(
    payload: SyncResolveRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> Response:
    await sync_service.resolve_discrepancy(
        db, payload.discrepancy_id, payload.action, resolver=current.id
    )
    await audit_service.log_event(
        db, category="SECURITY", event_code="SYNC_DISCREPANCY_RESOLVED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="DISCREPANCY", target_id=str(payload.discrepancy_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"action": payload.action},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

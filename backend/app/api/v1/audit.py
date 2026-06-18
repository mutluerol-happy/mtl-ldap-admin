# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Audit query API."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_permission
from app.schemas.audit import (
    AuditEventListResponse,
    AuditSummary,
    AuditSummaryBucket,
    EventLogPublic,
)
from app.services import audit_query_service

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get(
    "/events",
    response_model=AuditEventListResponse,
    summary="Audit event'leri listele (paginated, filter)",
)
async def list_events(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    category: str | None = Query(None, max_length=64),
    event_code: str | None = Query(None, max_length=64),
    severity: str | None = Query(None, max_length=16),
    actor_id: str | None = Query(None, max_length=128),
    actor_display: str | None = Query(None, max_length=128),
    target_id: str | None = Query(None, max_length=128),
    ip_address: str | None = Query(None, max_length=64),
    server_node: str | None = Query(None, max_length=64),
    search: str | None = Query(None, max_length=256),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> AuditEventListResponse:
    result = await audit_query_service.list_events(
        db,
        page=page, page_size=page_size,
        category=category, event_code=event_code, severity=severity,
        actor_id=actor_id, actor_display=actor_display, target_id=target_id,
        ip_address=ip_address, server_node=server_node, search=search,
        date_from=date_from, date_to=date_to,
    )
    return AuditEventListResponse(**result)


@router.get(
    "/events/{event_id}",
    response_model=EventLogPublic,
    summary="Tek audit event detayı",
)
async def get_event(
    event_id: int,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> EventLogPublic:
    event = await audit_query_service.get_event(db, event_id)
    return EventLogPublic.model_validate(event)


@router.get(
    "/categories",
    response_model=list[str],
    summary="Kullanılan event kategorileri",
)
async def list_categories(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> list[str]:
    return await audit_query_service.list_categories(db)


@router.get(
    "/event-codes",
    response_model=list[str],
    summary="Kullanılan event kod'ları",
)
async def list_event_codes(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> list[str]:
    return await audit_query_service.list_event_codes(db)


@router.get(
    "/server-nodes",
    response_model=list[str],
    summary="Olay kaydi olan sunucu dugumleri",
)
async def list_server_nodes(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> list[str]:
    return await audit_query_service.list_server_nodes(db)


@router.get(
    "/summary",
    response_model=AuditSummary,
    summary="Son N saatlik audit özeti",
)
async def get_summary(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
    hours: int = Query(24, ge=1, le=720),
) -> AuditSummary:
    data = await audit_query_service.get_summary(db, hours=hours)
    return AuditSummary(
        period_hours=data["period_hours"],
        total_events=data["total_events"],
        by_severity=data["by_severity"],
        by_category=data["by_category"],
        top_event_codes=data["top_event_codes"],
        top_actors=data["top_actors"],
        failed_login_count=data["failed_login_count"],
        successful_login_count=data["successful_login_count"],
        timeline=[AuditSummaryBucket(**b) for b in data["timeline"]],
    )

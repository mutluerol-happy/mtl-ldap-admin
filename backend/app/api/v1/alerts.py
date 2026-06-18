# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Alert endpoint'leri."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps import (
    CurrentAdmin,
    DbSession,
    get_request_meta,
    require_permission,
)
from app.schemas.alert import (
    AlertAckRequest,
    AlertEventListResponse,
    AlertEventPublic,
    AlertResolveRequest,
    AlertRulePublic,
    AlertRuleUpdateRequest,
)
from app.services import alert_service, audit_service

router = APIRouter(prefix="/alerts", tags=["alerts"])


# ============================================================================
# Rules
# ============================================================================


@router.get(
    "/rules",
    response_model=list[AlertRulePublic],
    summary="Alert kurallarını listele",
)
async def list_rules(
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> list[AlertRulePublic]:
    rules = await alert_service.list_rules(db, lang=getattr(request.state, "lang", "tr"))
    return [AlertRulePublic.model_validate(r) for r in rules]


@router.patch(
    "/rules/{rule_id}",
    response_model=AlertRulePublic,
    summary="Alert kuralını güncelle (threshold/cooldown/enabled vs.)",
)
async def update_rule(
    rule_id: UUID,
    payload: AlertRuleUpdateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> AlertRulePublic:
    rule = await alert_service.update_rule(
        db, rule_id, payload.model_dump(exclude_unset=True)
    )
    await audit_service.log_event(
        db, category="SECURITY", event_code="ALERT_RULE_UPDATED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ALERT_RULE", target_id=str(rule_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details=payload.model_dump(exclude_unset=True),
    )
    await db.commit()
    return AlertRulePublic.model_validate(rule)


# ============================================================================
# Events
# ============================================================================


@router.get(
    "",
    response_model=AlertEventListResponse,
    summary="Tetiklenen alert event'leri listele",
)
async def list_events(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    status: str | None = Query(None, description="open/acknowledged/resolved/suppressed"),
    severity: str | None = Query(None),
    rule_id: UUID | None = Query(None),
) -> AlertEventListResponse:
    result = await alert_service.list_events(
        db, page=page, page_size=page_size,
        status=status, severity=severity, rule_id=rule_id,
    )
    return AlertEventListResponse(
        total=result["total"], page=result["page"], page_size=result["page_size"],
        items=[AlertEventPublic.model_validate(i) for i in result["items"]],
    )


@router.get(
    "/{event_id}",
    response_model=AlertEventPublic,
    summary="Tek alert event detayı",
)
async def get_event(
    event_id: UUID,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> AlertEventPublic:
    event = await alert_service.get_event(db, event_id)
    return AlertEventPublic.model_validate(event)


@router.post(
    "/{event_id}/acknowledge",
    response_model=AlertEventPublic,
    summary="Alert'i acknowledge et",
)
async def ack_event(
    event_id: UUID,
    payload: AlertAckRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> AlertEventPublic:
    event = await alert_service.acknowledge(db, event_id, current.id, payload.note)
    await audit_service.log_event(
        db, category="SECURITY", event_code="ALERT_ACKNOWLEDGED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ALERT_EVENT", target_id=str(event_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"note": payload.note},
    )
    await db.commit()
    return AlertEventPublic.model_validate(event)


@router.post(
    "/{event_id}/resolve",
    response_model=AlertEventPublic,
    summary="Alert'i çöz",
)
async def resolve_event(
    event_id: UUID,
    payload: AlertResolveRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("audit.read"))],
) -> AlertEventPublic:
    event = await alert_service.resolve(db, event_id, current.id, payload.note)
    await audit_service.log_event(
        db, category="SECURITY", event_code="ALERT_RESOLVED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ALERT_EVENT", target_id=str(event_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"resolution_note": payload.note},
    )
    await db.commit()
    return AlertEventPublic.model_validate(event)

# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Alert engine.

  - Beat task `alert.evaluate_rules` her dakikada bir aktif rule'ları döner.
  - Sliding window içinde event_log üzerinde threshold kontrolü yapar.
  - Cooldown süresi içinde aynı rule tekrar tetiklenmez.
  - Tetiklenen alert mtl_alert.event tablosuna kayıt edilir.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.models.alert import AlertEvent, AlertRule
from app.models.audit import EventLog

logger = get_logger(__name__)


# ============================================================================
# Rule listing / CRUD lite
# ============================================================================


async def list_rules(db: AsyncSession, lang: str = "tr") -> list[AlertRule]:
    stmt = select(AlertRule).order_by(AlertRule.rule_code)
    rules = list((await db.execute(stmt)).scalars())
    if lang == "en":
        for r in rules:
            r.name = r.name_en or r.name
            r.description = r.description_en or r.description
    return rules


async def get_rule(db: AsyncSession, rule_id: UUID, lang: str = "tr") -> AlertRule:
    stmt = select(AlertRule).where(AlertRule.id == rule_id)
    rule = (await db.execute(stmt)).scalar_one_or_none()
    if rule is None:
        raise NotFoundError(f"Rule bulunamadı: {rule_id}", code="RULE_NOT_FOUND")
    if lang == "en" and rule is not None:
        rule.name = rule.name_en or rule.name
        rule.description = rule.description_en or rule.description
    return rule


async def update_rule(db: AsyncSession, rule_id: UUID, payload: dict[str, Any]) -> AlertRule:
    rule = await get_rule(db, rule_id)
    for key in ("enabled", "severity", "threshold_count", "window_minutes",
                "cooldown_minutes", "description", "notify_channels", "extra_config"):
        if key in payload and payload[key] is not None:
            setattr(rule, key, payload[key])
    await db.flush()
    return rule


# ============================================================================
# Event listing
# ============================================================================


async def list_events(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    status: str | None = None,
    severity: str | None = None,
    rule_id: UUID | None = None,
) -> dict[str, Any]:
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 500:
        page_size = 50

    base = select(AlertEvent)
    count_q = select(func.count()).select_from(AlertEvent)
    conds = []
    if status:
        conds.append(AlertEvent.status == status)
    if severity:
        conds.append(AlertEvent.severity == severity)
    if rule_id:
        conds.append(AlertEvent.rule_id == rule_id)
    if conds:
        base = base.where(and_(*conds))
        count_q = count_q.where(and_(*conds))

    total = (await db.execute(count_q)).scalar_one()
    base = base.order_by(AlertEvent.triggered_at.desc()).limit(page_size).offset((page - 1) * page_size)
    items = list((await db.execute(base)).scalars())

    return {"total": total, "page": page, "page_size": page_size, "items": items}


async def get_event(db: AsyncSession, event_id: UUID) -> AlertEvent:
    stmt = select(AlertEvent).where(AlertEvent.id == event_id)
    event = (await db.execute(stmt)).scalar_one_or_none()
    if event is None:
        raise NotFoundError(f"Alert event bulunamadı: {event_id}", code="ALERT_EVENT_NOT_FOUND")
    return event


async def acknowledge(db: AsyncSession, event_id: UUID, actor: UUID, note: str | None) -> AlertEvent:
    event = await get_event(db, event_id)
    if event.status not in ("open", "acknowledged"):
        raise ValidationError(
            f"'{event.status}' durumundaki alert ack edilemez",
            code="INVALID_STATE",
        )
    event.status = "acknowledged"
    event.acknowledged_at = datetime.now(timezone.utc)
    event.acknowledged_by = actor
    if note:
        event.extra_details = {**(event.extra_details or {}), "ack_note": note}
    await db.flush()
    logger.info("alert.acknowledged", event_id=str(event_id), actor=str(actor))
    return event


async def resolve(db: AsyncSession, event_id: UUID, actor: UUID, note: str) -> AlertEvent:
    event = await get_event(db, event_id)
    if event.status == "resolved":
        return event  # idempotent
    event.status = "resolved"
    event.resolved_at = datetime.now(timezone.utc)
    event.resolved_by = actor
    event.resolution_note = note
    await db.flush()
    logger.info("alert.resolved", event_id=str(event_id), actor=str(actor))
    return event


# ============================================================================
# Engine — beat task tarafından çağrılır
# ============================================================================


async def evaluate_all_rules(db: AsyncSession) -> dict[str, Any]:
    """Aktif tüm rule'ları döner ve tetiklenenler için AlertEvent yarat."""
    rules = [r for r in await list_rules(db) if r.enabled]
    total_triggered = 0
    results: list[dict[str, Any]] = []

    for rule in rules:
        try:
            triggered = await _evaluate_single(db, rule)
        except Exception as e:  # noqa: BLE001
            logger.exception("alert.eval_failed", rule=rule.rule_code, error=str(e))
            triggered = None
        if triggered:
            total_triggered += 1
            results.append({"rule": rule.rule_code, "alert_id": str(triggered.id)})

    await db.commit()
    return {"rules_evaluated": len(rules), "triggered": total_triggered, "details": results}


async def _evaluate_single(db: AsyncSession, rule: AlertRule) -> AlertEvent | None:
    """Tek bir rule için sliding window analiz."""
    now = datetime.now(timezone.utc)

    # Cooldown kontrolü
    if rule.last_triggered_at:
        cooldown_end = rule.last_triggered_at + timedelta(minutes=rule.cooldown_minutes)
        if now < cooldown_end:
            return None  # Cooldown'da

    window_start = now - timedelta(minutes=rule.window_minutes)

    rt = rule.rule_type
    matched_events: list[dict[str, Any]] = []
    summary: str = ""

    if rt == "FAILED_LOGIN_SPIKE":
        # Aynı actor_display veya IP'den 5+ failed login son N dakikada
        stmt = (
            select(
                func.coalesce(EventLog.actor_display, EventLog.ip_address).label("subj"),
                func.count().label("c"),
            )
            .where(
                EventLog.event_code == "LOGIN_FAILED",
                EventLog.occurred_at >= window_start,
            )
            .group_by(func.coalesce(EventLog.actor_display, EventLog.ip_address))
            .having(func.count() >= rule.threshold_count)
        )
        rows = (await db.execute(stmt)).all()
        if not rows:
            return None
        matched_events = [{"subject": r[0], "count": r[1]} for r in rows]
        summary = f"Başarısız giriş atağı: {len(rows)} subject ≥{rule.threshold_count} deneme"

    elif rt == "ACCOUNT_LOCKOUT_BURST":
        stmt = (
            select(func.count())
            .where(
                EventLog.event_code.in_(("USER_LOCKED", "ADMIN_LOCKOUT_THRESHOLD")),
                EventLog.occurred_at >= window_start,
            )
        )
        count = (await db.execute(stmt)).scalar_one()
        if count < rule.threshold_count:
            return None
        matched_events = [{"lockout_count": count}]
        summary = f"Hesap kilitlenme yoğunluğu: {count} olay/{rule.window_minutes}dk"

    elif rt == "MFA_BYPASS_ATTEMPT":
        # MFA_FAILED örüntüsü
        stmt = (
            select(EventLog.actor_display, func.count())
            .where(
                EventLog.event_code == "MFA_FAILED",
                EventLog.occurred_at >= window_start,
            )
            .group_by(EventLog.actor_display)
            .having(func.count() >= rule.threshold_count)
        )
        rows = (await db.execute(stmt)).all()
        if not rows:
            return None
        matched_events = [{"actor": r[0], "count": r[1]} for r in rows]
        summary = f"MFA bypass denemesi: {len(rows)} kullanıcı"

    elif rt == "PRIVILEGE_ESCALATION":
        # super_admin rolü atandığında
        stmt = (
            select(EventLog)
            .where(
                EventLog.event_code == "ROLE_ASSIGNED",
                EventLog.occurred_at >= window_start,
                EventLog.details["role_name"].astext.like("%super_admin%"),
            )
            .limit(20)
        )
        rows = list((await db.execute(stmt)).scalars())
        if len(rows) < rule.threshold_count:
            return None
        matched_events = [
            {"actor": r.actor_display, "target": r.target_display,
             "details": r.details, "occurred_at": r.occurred_at.isoformat()}
            for r in rows
        ]
        summary = f"Yetki yükseltme: {len(rows)} super_admin atama"

    elif rt == "ADMIN_CREATED":
        stmt = (
            select(EventLog)
            .where(
                EventLog.event_code == "ADMIN_CREATED",
                EventLog.occurred_at >= window_start,
            )
            .limit(20)
        )
        rows = list((await db.execute(stmt)).scalars())
        if len(rows) < rule.threshold_count:
            return None
        matched_events = [
            {"actor": r.actor_display, "target": r.target_display,
             "occurred_at": r.occurred_at.isoformat()}
            for r in rows
        ]
        summary = f"Yeni admin oluşturma: {len(rows)} kayıt"

    elif rt == "BULK_DELETE":
        stmt = (
            select(func.count())
            .where(
                EventLog.event_code.in_(("BULK_DELETE_STARTED", "USER_DELETED")),
                EventLog.occurred_at >= window_start,
            )
        )
        count = (await db.execute(stmt)).scalar_one()
        if count < rule.threshold_count:
            return None
        matched_events = [{"delete_count": count}]
        summary = f"Toplu silme: {count} olay/{rule.window_minutes}dk"

    else:
        # Bilinmeyen rule_type — sessizce atla
        return None

    # AlertEvent yarat
    alert = AlertEvent(
        rule_id=rule.id,
        severity=rule.severity,
        summary=summary,
        matched_events=matched_events,
        event_count=len(matched_events),
        window_start=window_start,
        window_end=now,
        status="open",
    )
    db.add(alert)
    rule.last_triggered_at = now
    await db.flush()

    logger.warning(
        "alert.triggered",
        rule=rule.rule_code,
        severity=rule.severity,
        summary=summary,
        count=len(matched_events),
    )
    return alert

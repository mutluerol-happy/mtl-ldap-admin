# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Audit event log query servisi (read-only)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.audit import EventLog


async def list_events(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    *,
    category: str | None = None,
    event_code: str | None = None,
    severity: str | None = None,
    actor_id: str | None = None,
    actor_display: str | None = None,
    target_id: str | None = None,
    ip_address: str | None = None,
    server_node: str | None = None,
    search: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> dict[str, Any]:
    """Paginated + filtered audit event listesi."""
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 500:
        page_size = 50

    base = select(EventLog)
    count_q = select(func.count()).select_from(EventLog)

    conditions = []
    if category:
        conditions.append(EventLog.category == category)
    if event_code:
        conditions.append(EventLog.event_code == event_code)
    if severity:
        conditions.append(EventLog.severity == severity)
    if actor_id:
        conditions.append(EventLog.actor_id == actor_id)
    if actor_display:
        conditions.append(func.lower(EventLog.actor_display).like(f"%{actor_display.lower()}%"))
    if target_id:
        conditions.append(EventLog.target_id == target_id)
    if ip_address:
        conditions.append(EventLog.ip_address == ip_address)
    if server_node:
        conditions.append(EventLog.server_node == server_node)
    if date_from:
        conditions.append(EventLog.occurred_at >= date_from)
    if date_to:
        conditions.append(EventLog.occurred_at <= date_to)
    if search:
        s = f"%{search.lower()}%"
        conditions.append(
            or_(
                func.lower(EventLog.event_code).like(s),
                func.lower(EventLog.actor_display).like(s),
                func.lower(EventLog.target_display).like(s),
                func.lower(EventLog.target_id).like(s),
            )
        )

    if conditions:
        base = base.where(and_(*conditions))
        count_q = count_q.where(and_(*conditions))

    total = (await db.execute(count_q)).scalar_one()
    base = base.order_by(EventLog.occurred_at.desc()).limit(page_size).offset((page - 1) * page_size)
    result = await db.execute(base)
    items = list(result.scalars())

    return {"total": total, "page": page, "page_size": page_size, "items": items}


async def get_event(db: AsyncSession, event_id: int) -> EventLog:
    stmt = select(EventLog).where(EventLog.id == event_id)
    result = await db.execute(stmt)
    event = result.scalar_one_or_none()
    if event is None:
        raise NotFoundError(f"Event bulunamadı: {event_id}", code="EVENT_NOT_FOUND")
    return event


async def list_categories(db: AsyncSession) -> list[str]:
    stmt = select(EventLog.category).distinct().order_by(EventLog.category)
    result = await db.execute(stmt)
    return [r for r in result.scalars() if r is not None]


async def list_event_codes(db: AsyncSession) -> list[str]:
    stmt = select(EventLog.event_code).distinct().order_by(EventLog.event_code)
    result = await db.execute(stmt)
    return [r for r in result.scalars() if r is not None]


async def list_server_nodes(db: AsyncSession) -> list[str]:
    stmt = select(EventLog.server_node).distinct().order_by(EventLog.server_node)
    result = await db.execute(stmt)
    return [r for r in result.scalars() if r is not None]


async def get_summary(db: AsyncSession, hours: int = 24) -> dict[str, Any]:
    """Son N saatlik özet."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    total_stmt = select(func.count()).select_from(EventLog).where(EventLog.occurred_at >= since)
    total = (await db.execute(total_stmt)).scalar_one()

    sev_stmt = (
        select(EventLog.severity, func.count())
        .where(EventLog.occurred_at >= since)
        .group_by(EventLog.severity)
    )
    by_severity = dict((await db.execute(sev_stmt)).all())

    cat_stmt = (
        select(EventLog.category, func.count())
        .where(EventLog.occurred_at >= since)
        .group_by(EventLog.category)
    )
    by_category = dict((await db.execute(cat_stmt)).all())

    code_stmt = (
        select(EventLog.event_code, func.count().label("c"))
        .where(EventLog.occurred_at >= since)
        .group_by(EventLog.event_code)
        .order_by(func.count().desc())
        .limit(10)
    )
    top_codes = [{"event_code": r[0], "count": r[1]} for r in (await db.execute(code_stmt)).all()]

    actor_stmt = (
        select(EventLog.actor_display, func.count().label("c"))
        .where(EventLog.occurred_at >= since, EventLog.actor_display.isnot(None))
        .group_by(EventLog.actor_display)
        .order_by(func.count().desc())
        .limit(10)
    )
    top_actors = [{"actor": r[0], "count": r[1]} for r in (await db.execute(actor_stmt)).all()]

    failed_logins_stmt = (
        select(func.count()).select_from(EventLog)
        .where(EventLog.event_code == "LOGIN_FAILED", EventLog.occurred_at >= since)
    )
    failed_login_count = (await db.execute(failed_logins_stmt)).scalar_one()

    success_logins_stmt = (
        select(func.count()).select_from(EventLog)
        .where(EventLog.event_code == "LOGIN_SUCCESS", EventLog.occurred_at >= since)
    )
    successful_login_count = (await db.execute(success_logins_stmt)).scalar_one()

    # Timeline: saat veya gün bazlı bucket
    bucket = "hour" if hours <= 48 else "day"
    timeline_stmt = (
        select(
            func.date_trunc(bucket, EventLog.occurred_at).label("b"),
            func.count().label("c"),
        )
        .where(EventLog.occurred_at >= since)
        .group_by("b")
        .order_by("b")
    )
    timeline = [{"bucket": str(r[0]), "count": r[1]} for r in (await db.execute(timeline_stmt)).all()]

    return {
        "period_hours": hours,
        "total_events": total,
        "by_severity": by_severity,
        "by_category": by_category,
        "top_event_codes": top_codes,
        "top_actors": top_actors,
        "failed_login_count": failed_login_count,
        "successful_login_count": successful_login_count,
        "timeline": timeline,
    }

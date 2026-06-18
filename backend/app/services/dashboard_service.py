# SPDX-License-Identifier: Apache-2.0
"""Dashboard özet toplama servisi."""
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.admin import AdminAccount
from app.models.alert import AlertEvent, AlertRule
from app.models.audit import EventLog


async def get_summary(db: AsyncSession) -> dict[str, Any]:
    """Dashboard'a özet veri topla."""
    now = datetime.now(timezone.utc)
    last_24h = now - timedelta(hours=24)

    # 1) Son 10 audit olayı
    recent_q = select(EventLog).order_by(EventLog.occurred_at.desc()).limit(10)
    recent_events = (await db.execute(recent_q)).scalars().all()

    # 2) Aktif alarmlar (open + acknowledged), rule ile join
    alert_q = (
        select(AlertEvent, AlertRule)
        .join(AlertRule, AlertEvent.rule_id == AlertRule.id, isouter=True)
        .where(AlertEvent.status.in_(["open", "acknowledged"]))
        .order_by(AlertEvent.triggered_at.desc())
        .limit(10)
    )
    rows = (await db.execute(alert_q)).all()
    active_alerts = []
    for ev, rule in rows:
        active_alerts.append({
            "id": str(ev.id),
            "rule_id": str(ev.rule_id),
            "rule_code": rule.rule_code if rule else None,
            "rule_name": rule.name if rule else None,
            "severity": ev.severity,
            "summary": ev.summary,
            "status": ev.status,
            "triggered_at": ev.triggered_at,
        })

    # 3) Security metrics
    total_admins = (
        await db.execute(select(func.count()).select_from(AdminAccount))
    ).scalar_one() or 0

    mfa_enrolled = (
        await db.execute(
            select(func.count()).select_from(AdminAccount)
            .where(AdminAccount.mfa_secret_encrypted.isnot(None))
        )
    ).scalar_one() or 0

    locked_admins = (
        await db.execute(
            select(func.count()).select_from(AdminAccount)
            .where(AdminAccount.locked_until.isnot(None))
            .where(AdminAccount.locked_until > now)
        )
    ).scalar_one() or 0

    inactive_admins = (
        await db.execute(
            select(func.count()).select_from(AdminAccount)
            .where(AdminAccount.is_active.is_(False))
        )
    ).scalar_one() or 0

    failed_24h = (
        await db.execute(
            select(func.count()).select_from(EventLog)
            .where(EventLog.event_code == "LOGIN_FAILED")
            .where(EventLog.occurred_at >= last_24h)
        )
    ).scalar_one() or 0

    mfa_pct = int(round(mfa_enrolled / total_admins * 100)) if total_admins else 0

    return {
        "recent_events": recent_events,
        "active_alerts": active_alerts,
        "security": {
            "total_admins": total_admins,
            "mfa_enrolled": mfa_enrolled,
            "mfa_enrollment_pct": mfa_pct,
            "locked_admins": locked_admins,
            "inactive_admins": inactive_admins,
            "failed_login_24h": failed_24h,
        },
    }

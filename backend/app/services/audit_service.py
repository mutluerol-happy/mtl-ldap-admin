# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Audit event yazıcı (mtl_audit.event_log için).

Login denemeleri, CRUD işlemleri, role değişiklikleri vs. buraya yazılır.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.audit import EventLog

logger = get_logger(__name__)


async def log_event(
    db: AsyncSession,
    *,
    category: str,
    event_code: str,
    severity: str = "INFO",
    actor_type: str | None = None,
    actor_id: str | None = None,
    actor_display: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    target_display: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    request_id: UUID | str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """
    event_log'a kayıt at.

    NOT: SQL'de trg_audit_no_modify trigger var — kayıt sonradan değiştirilemez.
    """
    settings = get_settings()

    # request_id string ise UUID'ye çevir
    if isinstance(request_id, str):
        try:
            request_id = UUID(request_id)
        except ValueError:
            request_id = None

    event = EventLog(
        occurred_at=datetime.now(timezone.utc),
        server_node=settings.node_id,
        category=category,
        event_code=event_code,
        severity=severity,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_display=actor_display,
        target_type=target_type,
        target_id=target_id,
        target_display=target_display,
        ip_address=ip_address,
        user_agent=(user_agent or "")[:1024] or None,
        request_id=request_id,
        details=details or {},
    )
    db.add(event)
    await db.flush()

    # Tur 4: Master ise cluster forward queue'ya at (slave'ler için)
    if settings.is_master:
        try:
            from app.services import cluster_service
            await cluster_service.enqueue_audit_event(db, event)
        except Exception as e:  # noqa: BLE001
            # Cluster sync hatası audit'i bozmamalı
            logger.warning("audit.cluster_enqueue_failed", error=str(e))
    # Fire-and-forget bildirim (Slack/Teams/Webhook) — hata olursa audit yine geçer
    try:
        import asyncio
        from app.services import notification_channels_service
        # Mesajı oku-kolay formatta hazırla
        parts = [f"severity={severity}"]
        if actor_display:
            parts.append(f"by {actor_display}")
        if target_display:
            parts.append(f"→ {target_display}")
        if details:
            small = {k: v for k, v in details.items() if k in ("reason", "error", "code", "result")}
            if small:
                parts.append(str(small))
        msg = " ".join(parts) if parts else "(no details)"
        asyncio.create_task(
            notification_channels_service.notify_async(event_code, msg)
        )
    except Exception:
        pass  # audit ana akışı bozma


async def log_login_attempt(
    db: AsyncSession,
    *,
    username: str,
    successful: bool,
    actor_id: str | None,  # admin UUID veya None (kullanıcı bulunamadıysa)
    actor_type: str = "ADMIN",
    failure_reason: str | None = None,
    mfa_used: bool = False,
    ip_address: str | None = None,
    user_agent: str | None = None,
    request_id: str | None = None,
) -> None:
    """Login denemesini event_log'a yaz."""
    event_code = "LOGIN_SUCCESS" if successful else "LOGIN_FAILED"
    severity = "INFO" if successful else "NOTICE"

    details: dict[str, Any] = {"username": username, "mfa_used": mfa_used}
    if failure_reason:
        details["failure_reason"] = failure_reason

    await log_event(
        db,
        category="SECURITY",
        event_code=event_code,
        severity=severity,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_display=username,
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
        details=details,
    )

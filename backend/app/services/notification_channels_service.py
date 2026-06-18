# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Bildirim Kanalları — Slack, Microsoft Teams, Generic Webhook.

Settings'ten okunur (kategori 'notifications'). Sensitive değerler Fernet ile decrypt.
notification_service.py SMTP'ye özel, bu modül dış kanallar için.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import SystemSetting

logger = logging.getLogger(__name__)

# Settings.events bos ise default olarak bildirilecek "onemli" event tipleri
# (spam koruması — INFO her log değil)
DEFAULT_NOTIFIABLE_EVENTS: set[str] = {
    "LOGIN_FAILED",
    "PASSWORD_RESET_REQUEST",
    "PASSWORD_RESET_COMPLETE",
    "PASSWORD_CHANGE",
    "USER_CREATE",
    "USER_DELETE",
    "USER_DISABLE",
    "USER_ENABLE",
    "ADMIN_CREATE",
    "ADMIN_DELETE",
    "ROLE_CHANGE",
    "MFA_DISABLED",
    "MFA_ENABLED",
    "SYNC_DISCREPANCY",
    "CLUSTER_FAILOVER",
    "SETTINGS_UPDATE",
}


async def _get_notifications_config(db: AsyncSession) -> dict[str, Any]:
    """notifications config'i DB'den oku (sensitive Fernet decrypt)."""
    from app.core.security import _fernet

    stmt = select(SystemSetting).where(SystemSetting.category == "notifications")
    rows = (await db.execute(stmt)).scalars().all()

    cfg: dict[str, Any] = {
        "slack_enabled": False,
        "slack_webhook_url": "",
        "teams_enabled": False,
        "teams_webhook_url": "",
        "webhook_enabled": False,
        "webhook_url": "",
        "webhook_method": "POST",
        "events": [],
    }

    for r in rows:
        # 'notifications.slack.enabled' → 'slack_enabled'
        key_short = r.key.replace("notifications.", "").replace(".", "_")

        if r.is_sensitive and r.encrypted_value:
            try:
                val = _fernet().decrypt(r.encrypted_value.encode()).decode()
            except Exception as e:
                logger.warning("notifications decrypt basarisiz %s: %s", r.key, e)
                continue
        else:
            val = r.value

        if val is None or val == "":
            continue

        if key_short.endswith("_enabled"):
            cfg[key_short] = str(val).lower() in ("true", "1", "yes", "on")
        elif key_short == "events":
            try:
                cfg[key_short] = json.loads(val) if val.strip().startswith("[") else []
            except json.JSONDecodeError:
                cfg[key_short] = []
        else:
            cfg[key_short] = val

    return cfg


# ----------------------------------------------------------------------------
# Provider: Slack (Incoming Webhook)
# ----------------------------------------------------------------------------
async def _send_slack(cfg: dict, text: str) -> dict[str, Any]:
    """Slack Incoming Webhook — POST JSON {text: '...'}"""
    url = cfg.get("slack_webhook_url", "").strip()
    if not url:
        return {"ok": False, "channel": "slack", "error": "webhook_url bos"}

    try:
        async with httpx.AsyncClient(timeout=15, verify=True) as client:
            resp = await client.post(url, json={"text": text})
            return {
                "ok": resp.status_code == 200 and (resp.text == "ok" or resp.status_code < 300),
                "status": resp.status_code,
                "channel": "slack",
                "body": (resp.text or "")[:300],
            }
    except httpx.TimeoutException:
        return {"ok": False, "channel": "slack", "error": "timeout"}
    except Exception as e:
        return {"ok": False, "channel": "slack", "error": str(e)[:200]}


# ----------------------------------------------------------------------------
# Provider: Microsoft Teams (Incoming Webhook)
# ----------------------------------------------------------------------------
async def _send_teams(cfg: dict, text: str) -> dict[str, Any]:
    """MS Teams Webhook — Adaptive Card formatı."""
    url = cfg.get("teams_webhook_url", "").strip()
    if not url:
        return {"ok": False, "channel": "teams", "error": "webhook_url bos"}

    # Teams basit message card
    payload = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "summary": "MTL LDAP Admin",
        "themeColor": "0078D7",
        "title": "MTL LDAP Admin",
        "text": text,
    }

    try:
        async with httpx.AsyncClient(timeout=15, verify=True) as client:
            resp = await client.post(url, json=payload)
            return {
                "ok": 200 <= resp.status_code < 300,
                "status": resp.status_code,
                "channel": "teams",
                "body": (resp.text or "")[:300],
            }
    except httpx.TimeoutException:
        return {"ok": False, "channel": "teams", "error": "timeout"}
    except Exception as e:
        return {"ok": False, "channel": "teams", "error": str(e)[:200]}


# ----------------------------------------------------------------------------
# Provider: Generic Webhook (POST JSON veya GET)
# ----------------------------------------------------------------------------
async def _send_webhook(cfg: dict, text: str, event: str | None = None) -> dict[str, Any]:
    """Generic webhook — yapılandırılabilir method (POST/GET)."""
    url = cfg.get("webhook_url", "").strip()
    if not url:
        return {"ok": False, "channel": "webhook", "error": "url bos"}

    method = (cfg.get("webhook_method") or "POST").upper()
    
    payload = {
        "source": "mtl-ldap-admin",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event or "TEST",
        "message": text,
    }

    try:
        async with httpx.AsyncClient(timeout=15, verify=True) as client:
            if method == "GET":
                resp = await client.get(url, params={"message": text, "event": event or "TEST"})
            else:
                resp = await client.post(url, json=payload)
            return {
                "ok": 200 <= resp.status_code < 300,
                "status": resp.status_code,
                "channel": "webhook",
                "body": (resp.text or "")[:300],
            }
    except httpx.TimeoutException:
        return {"ok": False, "channel": "webhook", "error": "timeout"}
    except Exception as e:
        return {"ok": False, "channel": "webhook", "error": str(e)[:200]}


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------
async def send_test(db: AsyncSession, channel: str) -> dict[str, Any]:
    """Test mesajı gönder. Enabled check bypass — kullanıcı yapılandırmayı test ediyor."""
    cfg = await _get_notifications_config(db)
    text = f"MTL LDAP Admin - {channel.upper()} test mesaji. Bu mesaj size ulastiysa yapilandirma OK."

    channel = channel.lower()
    if channel == "slack":
        return await _send_slack(cfg, text)
    if channel == "teams":
        return await _send_teams(cfg, text)
    if channel == "webhook":
        return await _send_webhook(cfg, text, event="TEST")
    return {"ok": False, "error": f"Bilinmeyen kanal: {channel}"}


async def notify_event(db: AsyncSession, event: str, text: str) -> None:
    """Audit/alert event geldiğinde tüm aktif kanalları çağırır. Fire-and-forget."""
    cfg = await _get_notifications_config(db)
    
    # Event filter:
    #   - Admin Settings.events doldurmusa: o listedekiler
    #   - Bos ise: DEFAULT_NOTIFIABLE_EVENTS (spam koruması)
    events_filter = cfg.get("events", [])
    if events_filter:
        if event not in events_filter:
            return
    else:
        if event not in DEFAULT_NOTIFIABLE_EVENTS:
            return

    full_text = f"[{event}] {text}"

    # Aktif kanalları sırayla dene (fail-soft)
    if cfg.get("slack_enabled"):
        try:
            result = await _send_slack(cfg, full_text)
            if not result.get("ok"):
                logger.warning("notify.slack_failed: %s", result.get("error"))
        except Exception as e:
            logger.warning("notify.slack_exception: %s", e)

    if cfg.get("teams_enabled"):
        try:
            result = await _send_teams(cfg, full_text)
            if not result.get("ok"):
                logger.warning("notify.teams_failed: %s", result.get("error"))
        except Exception as e:
            logger.warning("notify.teams_exception: %s", e)

    if cfg.get("webhook_enabled"):
        try:
            result = await _send_webhook(cfg, full_text, event=event)
            if not result.get("ok"):
                logger.warning("notify.webhook_failed: %s", result.get("error"))
        except Exception as e:
            logger.warning("notify.webhook_exception: %s", e)


# ----------------------------------------------------------------------------
# notify_async — fire-and-forget helper (yeni DB session ile)
# ----------------------------------------------------------------------------
async def notify_async(event: str, text: str) -> None:
    """Yeni DB session ile bildirim gönder. asyncio.create_task ile çağrılır."""
    try:
        from app.core.db import get_sessionmaker
        SF = get_sessionmaker()
        async with SF() as db:
            await notify_event(db, event=event, text=text)
    except Exception as e:
        logger.warning("notify_async_failed event=%s err=%s", event, e)

# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Bildirim kanalları:
  - email   (SMTP, mevcut email_service üzerinden)
  - webhook (generic JSON POST)
  - slack   (Slack incoming webhook formatı)
  - teams   (Microsoft Teams incoming webhook formatı)

Kanalları system_setting kategorisi 'notification' yönetir.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import SystemSetting

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session as SyncSession

from app.core.config import get_settings as _get_app_settings
from app.core.security import _fernet as _smtp_fernet

logger = logging.getLogger(__name__)



async def get_notification_config(db: AsyncSession) -> dict[str, Any]:
    """Notification ayarlarını DB'den oku."""
    stmt = select(SystemSetting).where(SystemSetting.category == "notification")
    rows = (await db.execute(stmt)).scalars().all()
    cfg: dict[str, Any] = {
        "enabled_channels": ["email"],
        "webhook_url": "",
        "slack_webhook_url": "",
        "teams_webhook_url": "",
        "webhook_timeout_sec": 5,
    }
    for r in rows:
        key = r.key.rsplit(".", 1)[-1] if "." in r.key else r.key
        raw = r.value
        if raw is None:
            continue
        if r.value_type == "json":
            try:
                cfg[key] = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                pass
        elif r.value_type == "integer":
            try:
                cfg[key] = int(raw)
            except (ValueError, TypeError):
                pass
        else:
            cfg[key] = raw
    return cfg


async def _send_webhook(url: str, payload: dict[str, Any], timeout: int = 5) -> dict[str, Any]:
    """Generic webhook gönder. Hata throw etmez, sonuç dict döner."""
    if not url:
        return {"ok": False, "error": "URL boş"}
    try:
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            resp = await client.post(url, json=payload, headers={"User-Agent": "MTL-LDAP-Admin/1.0"})
            return {
                "ok": 200 <= resp.status_code < 300,
                "status": resp.status_code,
                "body": (resp.text or "")[:500],
            }
    except httpx.TimeoutException:
        return {"ok": False, "error": "timeout"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


async def send_slack(text: str, *, db: AsyncSession, title: str | None = None) -> dict[str, Any]:
    """Slack incoming webhook formatında mesaj gönder."""
    cfg = await get_notification_config(db)
    url = cfg.get("slack_webhook_url") or ""
    if not url:
        return {"ok": False, "channel": "slack", "error": "slack_webhook_url ayarlı değil"}
    payload: dict[str, Any] = {"text": f"*{title}*\n{text}" if title else text}
    result = await _send_webhook(url, payload, timeout=cfg.get("webhook_timeout_sec", 5))
    result["channel"] = "slack"
    return result


async def send_teams(text: str, *, db: AsyncSession, title: str | None = None) -> dict[str, Any]:
    """Microsoft Teams incoming webhook formatında mesaj gönder."""
    cfg = await get_notification_config(db)
    url = cfg.get("teams_webhook_url") or ""
    if not url:
        return {"ok": False, "channel": "teams", "error": "teams_webhook_url ayarlı değil"}
    # Teams MessageCard formatı
    payload: dict[str, Any] = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "summary": title or "MTL Bildirimi",
        "themeColor": "F59E0B",  # amber
        "title": title or "MTL Bildirimi",
        "text": text,
    }
    result = await _send_webhook(url, payload, timeout=cfg.get("webhook_timeout_sec", 5))
    result["channel"] = "teams"
    return result


async def send_webhook(text: str, *, db: AsyncSession, title: str | None = None, extra: dict | None = None) -> dict[str, Any]:
    """Generic webhook — JSON payload."""
    cfg = await get_notification_config(db)
    url = cfg.get("webhook_url") or ""
    if not url:
        return {"ok": False, "channel": "webhook", "error": "webhook_url ayarlı değil"}
    payload: dict[str, Any] = {
        "source": "mtl-ldap-admin",
        "title": title or "MTL Bildirimi",
        "text": text,
    }
    if extra:
        payload.update(extra)
    result = await _send_webhook(url, payload, timeout=cfg.get("webhook_timeout_sec", 5))
    result["channel"] = "webhook"
    return result


async def broadcast(
    text: str,
    *,
    db: AsyncSession,
    title: str | None = None,
    channels: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Aktif kanallara aynı mesajı paralel gönder.
    
    channels None ise system_setting'teki enabled_channels kullanılır.
    """
    cfg = await get_notification_config(db)
    targets = channels or cfg.get("enabled_channels", ["email"])

    tasks: list[Any] = []
    if "webhook" in targets:
        tasks.append(send_webhook(text, db=db, title=title))
    if "slack" in targets:
        tasks.append(send_slack(text, db=db, title=title))
    if "teams" in targets:
        tasks.append(send_teams(text, db=db, title=title))
    # email — mevcut email_service ile (varsa)
    # TODO: email_service entegrasyonu (zaten ayrı işliyor)

    if not tasks:
        return []

    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: list[dict[str, Any]] = []
    for r in results:
        if isinstance(r, dict):
            out.append(r)
        else:
            out.append({"ok": False, "error": f"{type(r).__name__}: {r}"})
    return out


async def test_channel(channel: str, *, db: AsyncSession) -> dict[str, Any]:
    """Belirli bir kanala test mesajı gönder."""
    text = "🔔 MTL LDAP Admin test bildirimi — yapılandırma çalışıyor."
    title = "MTL Test Bildirimi"
    if channel == "slack":
        return await send_slack(text, db=db, title=title)
    elif channel == "teams":
        return await send_teams(text, db=db, title=title)
    elif channel == "webhook":
        return await send_webhook(text, db=db, title=title)
    else:
        return {"ok": False, "channel": channel, "error": f"bilinmeyen kanal: {channel}"}


def _read_smtp_config_sync() -> dict:
    """SMTP config'i sync DB sorgusuyla oku."""
    from app.models.setting import SystemSetting as _SS
    from sqlalchemy import select as _sel

    app_settings = _get_app_settings()
    db_url = str(app_settings.db_url)
    sync_url = (
        db_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
              .replace("+asyncpg", "+psycopg2")
    )

    cfg = {
        "host": "smtp.gmail.com",
        "port": 587,
        "user": "",
        "password": "",
        "from": "",
        "use_tls": True,
    }

    engine = create_engine(sync_url, pool_pre_ping=True, pool_size=1, max_overflow=0)
    try:
        with SyncSession(engine) as db:
            rows = db.execute(_sel(_SS).where(_SS.category == "smtp")).scalars().all()
            for r in rows:
                k = r.key.rsplit(".", 1)[-1] if "." in r.key else r.key
                # Variants
                if k in ("smtp_host",): k = "host"
                if k in ("smtp_port",): k = "port"
                if k in ("smtp_user", "username"): k = "user"
                if k in ("smtp_password", "smtp_pass"): k = "password"
                if k in ("smtp_from", "from_address", "sender"): k = "from"
                if k in ("starttls", "tls"): k = "use_tls"

                # Sensitive ise encrypted_value'dan Fernet ile decrypt et
                if r.is_sensitive and r.encrypted_value:
                    try:
                        v = _smtp_fernet().decrypt(r.encrypted_value.encode()).decode()
                    except Exception as _de:
                        logger.warning("decrypt basarisiz %s: %s", r.key, _de)
                        continue
                else:
                    v = r.value
                if v is None or v == "":
                    continue
                if k == "port":
                    try: cfg["port"] = int(v)
                    except (ValueError, TypeError): pass
                elif k == "use_tls":
                    cfg["use_tls"] = str(v).lower() in ("true", "1", "yes", "on")
                else:
                    cfg[k] = v
    finally:
        engine.dispose()

    if not cfg.get("from"):
        cfg["from"] = cfg.get("user") or "noreply@mtl.local"
    return cfg


def send_password_reset_email(
    *, to: str, uid: str, otp: str, ttl_minutes: int = 15,
) -> bool:
    """SMTP uzerinden OTP iceren parola sifirlama e-postasi gonder (sync)."""
    cfg = _read_smtp_config_sync()
    if not cfg.get("host") or not cfg.get("user") or not cfg.get("password"):
        logger.warning(
            "send_password_reset_email: SMTP config eksik (host=%s user=%s pwd=%s) — e-posta gonderilmedi",
            cfg.get("host"), cfg.get("user"), "***" if cfg.get("password") else "(bos)",
        )
        return False

    subject = "MTL — Parola Sifirlama Kodu"
    body_text = (
        f"Merhaba {uid},\n\n"
        f"MTL kullanici paneli icin parola sifirlama isteginizi aldik.\n\n"
        f"Dogrulama kodunuz:  {otp}\n\n"
        f"Bu kod {ttl_minutes} dakika boyunca gecerlidir.\n\n"
        f"Bu islemi siz yapmadiysaniz bu e-postayi yok sayabilirsiniz.\n\n"
        f"— MTL LDAP Admin"
    )
    body_html = (
        '<html><body style="font-family: sans-serif; max-width: 600px;">'
        '<h2 style="color: #f59e0b;">MTL — Parola Sifirlama</h2>'
        f'<p>Merhaba <b>{uid}</b>,</p>'
        '<p>MTL kullanici paneli icin parola sifirlama isteginizi aldik.</p>'
        '<p>Dogrulama kodunuz:</p>'
        '<p style="font-size: 28px; font-family: monospace; background: #f3f4f6; '
        'padding: 16px; text-align: center; letter-spacing: 4px; border-radius: 8px;">'
        f'<b>{otp}</b></p>'
        f'<p>Bu kod <b>{ttl_minutes} dakika</b> boyunca gecerlidir.</p>'
        '<p style="color: #6b7280; font-size: 12px; margin-top: 32px;">'
        'Bu islemi siz yapmadiysaniz bu e-postayi yok sayabilirsiniz.<br>'
        '— MTL LDAP Admin</p>'
        '</body></html>'
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg["from"]
    msg["To"] = to
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        with smtplib.SMTP(cfg["host"], int(cfg["port"]), timeout=15) as server:
            server.ehlo()
            if cfg.get("use_tls", True):
                server.starttls()
                server.ehlo()
            server.login(cfg["user"], cfg["password"])
            server.send_message(msg)
        logger.info("password_reset_email gonderildi: to=%s uid=%s", to, uid)
        return True
    except smtplib.SMTPAuthenticationError as e:
        logger.error(
            "SMTP auth hatasi (Gmail icin App Password gerekli; "
            "https://myaccount.google.com/apppasswords): %s", e,
        )
        return False
    except smtplib.SMTPException as e:
        logger.error("SMTP hatasi: %s", e)
        return False
    except Exception as e:
        logger.error("E-posta gonderme hatasi: %s", e, exc_info=True)
        return False

# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
SMS gönderim servisi — provider abstraction.

Desteklenen sağlayıcılar:
  - netgsm   : Netgsm HTTP REST v2 (TR popüler)
  - twilio   : Twilio REST API (international)
  - mock     : Sadece log (test için)
  - iletimerkezi : (TODO — yapı hazır, endpoint Şirket'ten alınır)
  - vonage   : (TODO)

Settings'ten okunur (kategori 'sms'). Sensitive değerler Fernet ile decrypt edilir.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import SystemSetting

logger = logging.getLogger(__name__)


async def _get_sms_config(db: AsyncSession) -> dict[str, Any]:
    """SMS config'i DB'den oku (sensitive değerler Fernet ile decrypt)."""
    from app.core.security import _fernet

    stmt = select(SystemSetting).where(SystemSetting.category == "sms")
    rows = (await db.execute(stmt)).scalars().all()

    cfg: dict[str, Any] = {
        "enabled": False,
        "provider": "netgsm",
        "api_url": "",
        "username": "",
        "password": "",
        "api_key": "",
        "sender_id": "MTL",
        "from_number": "",
        "test_to_number": "",
    }

    for r in rows:
        key = r.key.rsplit(".", 1)[-1] if "." in r.key else r.key

        if r.is_sensitive and r.encrypted_value:
            try:
                val = _fernet().decrypt(r.encrypted_value.encode()).decode()
            except Exception as e:
                logger.warning("sms decrypt basarisiz %s: %s", r.key, e)
                continue
        else:
            val = r.value

        if val is None or val == "":
            continue

        if key == "enabled":
            cfg["enabled"] = str(val).lower() in ("true", "1", "yes", "on")
        else:
            cfg[key] = val

    return cfg


# ----------------------------------------------------------------------------
# Provider: Netgsm (HTTP REST v2)
# ----------------------------------------------------------------------------
async def _send_netgsm(cfg: dict, to: str, text: str) -> dict[str, Any]:
    """Netgsm REST v2 send.
    
    Auth: HTTP Basic (username:password)
    Endpoint: https://api.netgsm.com.tr/sms/rest/v2/send
    """
    url = cfg.get("api_url") or "https://api.netgsm.com.tr/sms/rest/v2/send"
    user = cfg.get("username", "")
    pwd = cfg.get("password") or cfg.get("api_key", "")
    sender = cfg.get("sender_id", "MTL")

    if not user or not pwd:
        return {"ok": False, "provider": "netgsm", "error": "username veya password bos"}

    payload = {
        "msgheader": sender,
        "messages": [{"msg": text, "no": to}],
    }

    try:
        async with httpx.AsyncClient(timeout=15, verify=True) as client:
            resp = await client.post(url, json=payload, auth=(user, pwd))
            ok = 200 <= resp.status_code < 300
            # Netgsm response: code 00 başarı
            body_text = resp.text or ""
            if ok and "code" in body_text:
                import json
                try:
                    data = json.loads(body_text)
                    code = str(data.get("code", "?"))
                    if code != "00":
                        ok = False
                except json.JSONDecodeError:
                    pass
            return {
                "ok": ok,
                "status": resp.status_code,
                "provider": "netgsm",
                "body": body_text[:500],
            }
    except httpx.TimeoutException:
        return {"ok": False, "provider": "netgsm", "error": "timeout"}
    except Exception as e:
        return {"ok": False, "provider": "netgsm", "error": str(e)[:200]}


# ----------------------------------------------------------------------------
# Provider: Twilio
# ----------------------------------------------------------------------------
async def _send_twilio(cfg: dict, to: str, text: str) -> dict[str, Any]:
    """Twilio REST: POST /Accounts/{SID}/Messages.json."""
    account_sid = cfg.get("username", "")
    auth_token = cfg.get("api_key") or cfg.get("password", "")
    from_num = cfg.get("from_number") or cfg.get("sender_id", "")

    if not account_sid or not auth_token or not from_num:
        return {
            "ok": False,
            "provider": "twilio",
            "error": "username (SID) / api_key (token) / from_number gerekli",
        }

    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url,
                data={"From": from_num, "To": to, "Body": text},
                auth=(account_sid, auth_token),
            )
            return {
                "ok": 200 <= resp.status_code < 300,
                "status": resp.status_code,
                "provider": "twilio",
                "body": (resp.text or "")[:500],
            }
    except httpx.TimeoutException:
        return {"ok": False, "provider": "twilio", "error": "timeout"}
    except Exception as e:
        return {"ok": False, "provider": "twilio", "error": str(e)[:200]}


# ----------------------------------------------------------------------------
# Provider: URL Template (generic GET — özel CGI/REST, intranet GSM modem vb.)
# ----------------------------------------------------------------------------
async def _send_url_template(cfg: dict, to: str, text: str) -> dict[str, Any]:
    """Generic URL template provider.
    
    api_url alanına placeholder'lı URL girilir:
      http://host/sms?to={{phone}}&msg={{message}}
    
    Desteklenen placeholder'lar:
      {{phone}}, {{to}}, {{number}}  → alıcı numarası
      {{message}}, {{text}}, {{content}} → mesaj metni
    
    Değerler URL-encode edilir. HTTP GET yapılır, 2xx = başarı.
    """
    import urllib.parse
    
    url_template = (cfg.get("api_url") or "").strip()
    if not url_template:
        return {"ok": False, "provider": "url_template", "error": "api_url (URL template) bos"}
    
    if "{{phone}}" not in url_template and "{{to}}" not in url_template and "{{number}}" not in url_template:
        return {
            "ok": False,
            "provider": "url_template",
            "error": "api_url icinde {{phone}}, {{to}} veya {{number}} placeholder bulunmali",
        }
    
    # Placeholder'ları doldur (URL-encode)
    enc_to = urllib.parse.quote(to, safe="+")
    enc_text = urllib.parse.quote(text, safe="")
    
    url = (
        url_template
        .replace("{{phone}}", enc_to)
        .replace("{{to}}", enc_to)
        .replace("{{number}}", enc_to)
        .replace("{{message}}", enc_text)
        .replace("{{text}}", enc_text)
        .replace("{{content}}", enc_text)
    )
    
    logger.info("url_template SMS: %s", url[:200])
    
    try:
        async with httpx.AsyncClient(timeout=20, verify=False) as client:
            resp = await client.get(url)
            return {
                "ok": 200 <= resp.status_code < 300,
                "status": resp.status_code,
                "provider": "url_template",
                "body": (resp.text or "")[:500],
            }
    except httpx.TimeoutException:
        return {"ok": False, "provider": "url_template", "error": "timeout"}
    except Exception as e:
        _msg = str(e)
        # Bazi CGI gateway'ler (orn WebCGI) SMS'i GONDERIR ama HTTP yanitina
        # standart-disi bir satir karistirir ("Setting max files open to 2048"
        # gibi) -> httpx yaniti parse edemez. Istek gateway'e ULASTI ve islendi;
        # gonderildi say. Gercek baglanti hatalari (ConnectError vb.) ok=False kalir.
        if (isinstance(e, httpx.RemoteProtocolError)
                or "illegal header line" in _msg
                or "Setting max files open" in _msg):
            logger.warning(
                "url_template gateway yaniti bozuk (SMS muhtemelen gonderildi): %s",
                _msg[:200],
            )
            return {
                "ok": True,
                "provider": "url_template",
                "status": 0,
                "note": "gateway response unparseable; treated as sent",
            }
        return {"ok": False, "provider": "url_template", "error": _msg[:200]}


# ----------------------------------------------------------------------------
# Provider: Mock (test)
# ----------------------------------------------------------------------------
async def _send_mock(cfg: dict, to: str, text: str) -> dict[str, Any]:
    logger.info("MOCK SMS gonderildi: to=%s text=%s", to, text)
    return {"ok": True, "provider": "mock", "body": f"Mock SMS gonderildi -> {to}"}


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------
async def send_sms(db: AsyncSession, *, to: str, text: str) -> dict[str, Any]:
    """SMS gönder. Provider config'ten okunur."""
    cfg = await _get_sms_config(db)
    if not cfg.get("enabled"):
        return {"ok": False, "error": "SMS bildirimleri aktif degil (settings sms.enabled=false)"}
    return await _dispatch(cfg, to, text)


async def send_test_sms(db: AsyncSession, to: str | None = None) -> dict[str, Any]:
    """Test SMS gönder (enabled kontrolü atlanır — kullanıcı yapılandırmayı test ediyor)."""
    cfg = await _get_sms_config(db)
    target = (to or cfg.get("test_to_number") or "").strip()
    if not target:
        return {
            "ok": False,
            "error": "Test alici numarasi bos. Settings sms.test_to_number doldurun veya istekte to_number gonderin.",
        }
    text = "MTL LDAP Admin - SMS gateway test mesaji. Bu mesaj size ulastiysa SMS yapilandirmasi OK."
    return await _dispatch(cfg, target, text)


async def _dispatch(cfg: dict, to: str, text: str) -> dict[str, Any]:
    provider = (cfg.get("provider") or "netgsm").lower()
    if provider == "netgsm":
        return await _send_netgsm(cfg, to, text)
    if provider == "twilio":
        return await _send_twilio(cfg, to, text)
    if provider == "url_template":
        return await _send_url_template(cfg, to, text)
    if provider == "mock":
        return await _send_mock(cfg, to, text)
    return {"ok": False, "error": f"Bilinmeyen provider: {provider}"}

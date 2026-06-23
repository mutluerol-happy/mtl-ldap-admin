# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""System settings business logic.

list_all() — kategori-bazlı liste (hassas alanlar opsiyonel maskelenir)
get_setting() — tek satır (model)
get_value() — diğer servisler için: decrypted+parsed gerçek değer
update_setting() — validation + audit-ready (audit caller'da log'lanır)
send_smtp_test() — SMTP ayarlarıyla test maili
"""

from __future__ import annotations

import json
import smtplib
from email.mime.text import MIMEText
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.models.setting import SystemSetting

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Fernet utility — Tur 3'te app.core.crypto.get_fernet var; bulunamazsa
# config.fernet_key veya secret_key'den fallback üretiriz.
# ---------------------------------------------------------------------------
def _get_fernet():
    """Fernet instance — app.core.security'den alır (settings.fernet_key kullanır)."""
    from app.core.security import _fernet as _core_fernet
    return _core_fernet()


# ---------------------------------------------------------------------------
# Kategori metadata — UI başlık + açıklama
# ---------------------------------------------------------------------------
CATEGORY_META: dict[str, dict[str, str]] = {
    "password_policy": {
        "title": "Parola Politikası",
        "description": "Kullanıcı ve yönetici parolaları için zorunluluklar.",
    },
    "password_reset": {
        "title": "Parola Sıfırlama",
        "description": "Self-service parola sıfırlama kanalı (e-posta, SMS) ve LDAP attribute eşleşmesi.",
    },
    "mfa_policy": {
        "title": "MFA Politikası",
        "description": "Çok faktörlü kimlik doğrulama kuralları.",
    },
    "security": {
        "title": "Güvenlik / Oturum",
        "description": "Oturum zaman aşımı ve güvenlik politikaları.",
    },
    "audit_retention": {
        "title": "Audit Saklama",
        "description": "Audit ve alert kayıtlarının saklama süreleri.",
    },
    "smtp": {
        "title": "SMTP / E-posta",
        "description": "Bildirim mailleri için sunucu yapılandırması.",
    },
    "sms": {
        "title": "SMS Gateway",
        "description": "SMS bildirimleri için sağlayıcı (Netgsm, Twilio, Vonage, İletimerkezi).",
    },
    "notifications": {
        "title": "Bildirim Kanalları",
        "description": "Slack, Microsoft Teams ve generic webhook bildirimleri (audit/alert olayları için).",
    },
    "email_templates": {
        "title": "E-posta Şablonları",
        "description": "Bildirim mailleri için konu/gövde şablonları (Jinja-style {{degisken}}).",
    },
}


# EN translations for CATEGORY_META (i18n)
CATEGORY_META_EN: dict[str, dict[str, str]] = {
    "password_policy":  {"title": "Password Policy",   "description": "Requirements for user and admin passwords."},
    "password_reset":   {"title": "Password Reset",    "description": "Self-service password reset channel (email, SMS) and LDAP attribute mapping."},
    "mfa_policy":       {"title": "MFA Policy",        "description": "Two-factor authentication rules."},
    "security":         {"title": "Security / Session", "description": "Session idle timeout and security policies."},
    "audit_retention":  {"title": "Audit Retention",   "description": "Retention periods for audit and alert records."},
    "smtp":             {"title": "SMTP",              "description": "Server configuration for notification emails."},
    "sms":              {"title": "SMS",               "description": "SMS notifications (Netgsm, Twilio, Vonage)."},
    "notifications":    {"title": "Notifications",     "description": "Slack, Microsoft Teams and generic webhook notifications."},
    "notification":     {"title": "Notifications",     "description": "Slack, Microsoft Teams and generic webhook notifications."},
    "email_templates":  {"title": "Email Templates",   "description": "Subject/body templates for notification emails (Jinja-style {{variable}})."},
}


# UI'da görünme sırası
CATEGORY_ORDER = list(CATEGORY_META.keys())


# ---------------------------------------------------------------------------
# Value parse / serialize / validate
# ---------------------------------------------------------------------------
def parse_value(raw: str | None, value_type: str) -> Any:
    """String raw → Python tip."""
    if raw is None or raw == "":
        return None
    if value_type == "string":
        return raw
    if value_type == "integer":
        try:
            return int(raw)
        except (ValueError, TypeError):
            return 0
    if value_type == "boolean":
        return str(raw).lower() in ("true", "1", "yes", "on")
    if value_type == "json":
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None
    return raw


def serialize_value(value: Any, value_type: str) -> str:
    """Python tip → DB string."""
    if value is None:
        return ""
    if value_type == "boolean":
        return "true" if value else "false"
    if value_type == "json":
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def validate_value(key: str, value: Any, value_type: str) -> None:
    """İş kuralları doğrulama. ValidationError raise eder."""
    if value_type == "integer":
        try:
            iv = int(value) if value not in (None, "") else 0
        except (ValueError, TypeError) as e:
            raise ValidationError(
                f"'{key}' integer olmalı", code="INVALID_TYPE"
            ) from e

        ranges: dict[str, tuple[int, int]] = {
            "password.min_length": (4, 128),
            "password.max_length": (8, 1024),
            "password.history_count": (0, 50),
            "password.max_age_days": (0, 3650),
            "password.min_age_hours": (0, 8760),
            "mfa.backup_codes_count": (0, 50),
            "audit.event_retention_days": (7, 36500),
            "audit.alert_retention_days": (7, 36500),
            "smtp.port": (1, 65535),
        }
        if key in ranges:
            lo, hi = ranges[key]
            if iv < lo or iv > hi:
                raise ValidationError(
                    f"'{key}' {lo}-{hi} aralığında olmalı", code="INVALID_RANGE"
                )

        if key == "mfa.totp_period" and iv not in (15, 30, 60):
            raise ValidationError("TOTP periyodu 15, 30 veya 60 olmalı", code="INVALID_VALUE")
        if key == "mfa.totp_digits" and iv not in (6, 8):
            raise ValidationError("TOTP rakam sayısı 6 veya 8 olmalı", code="INVALID_VALUE")

    if value_type == "boolean":
        if not isinstance(value, bool) and str(value).lower() not in (
            "true", "false", "1", "0", "yes", "no", "on", "off"
        ):
            raise ValidationError(f"'{key}' boolean olmalı", code="INVALID_TYPE")

    if value_type == "string":
        if value is not None and len(str(value)) > 4096:
            raise ValidationError(f"'{key}' değeri çok uzun (max 4096)", code="INVALID_LENGTH")

    # Özel format kontrolleri
    if key == "smtp.from_email" and value:
        if "@" not in str(value) or "." not in str(value):
            raise ValidationError("Geçerli e-posta adresi giriniz", code="INVALID_EMAIL")
    if key == "smtp.host" and value:
        if len(str(value)) > 255:
            raise ValidationError("Host adı çok uzun", code="INVALID_LENGTH")

    # Min ≤ Max kontrolleri kategori bazında değil setting-bazında olduğu için
    # tam consistency check için iki çağrı gerekir; burada tek tek kabul ediyoruz.


# ---------------------------------------------------------------------------
# Core CRUD
# ---------------------------------------------------------------------------
async def get_setting(db: AsyncSession, category: str, key: str) -> SystemSetting:
    stmt = select(SystemSetting).where(
        SystemSetting.category == category,
        SystemSetting.key == key,
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if not row:
        raise NotFoundError(
            f"Ayar bulunamadı: {category}.{key}", code="SETTING_NOT_FOUND"
        )
    return row


async def get_value(db: AsyncSession, category: str, key: str) -> Any:
    """Diğer servisler için decrypted+parsed değer döner."""
    s = await get_setting(db, category, key)
    if s.is_sensitive:
        if not s.encrypted_value:
            return None
        try:
            raw = _get_fernet().decrypt(s.encrypted_value.encode()).decode()
        except Exception as e:
            logger.warning("settings.decrypt_failed %s.%s: %s", category, key, e)
            return None
        return parse_value(raw, s.value_type)
    return parse_value(s.value, s.value_type)


async def list_all(
    db: AsyncSession,
    include_sensitive: bool = False,
    lang: str = "tr",
) -> dict[str, Any]:
    """Tüm ayarları kategoriler halinde döner. include_sensitive=False ise
    hassas değerler '***' string'i ile maskelenir."""
    stmt = select(SystemSetting).order_by(SystemSetting.category, SystemSetting.key)
    result = await db.execute(stmt)
    rows: list[SystemSetting] = list(result.scalars().all())

    by_category: dict[str, list[SystemSetting]] = {}
    for r in rows:
        by_category.setdefault(r.category, []).append(r)

    fernet = None
    if include_sensitive and any(r.is_sensitive for r in rows):
        try:
            fernet = _get_fernet()
        except Exception:
            fernet = None  # decrypt edemezse maskele

    ordered_cats = [c for c in CATEGORY_ORDER if c in by_category]
    other_cats = sorted([c for c in by_category if c not in CATEGORY_ORDER])

    categories: list[dict[str, Any]] = []
    for cat in ordered_cats + other_cats:
        cat_settings: list[dict[str, Any]] = []
        for s in by_category[cat]:
            if s.is_sensitive:
                has_value = bool(s.encrypted_value)
                if include_sensitive and has_value and fernet:
                    try:
                        raw = fernet.decrypt(s.encrypted_value.encode()).decode()
                        display: Any = parse_value(raw, s.value_type)
                    except Exception:
                        display = "***"  # decrypt fail
                else:
                    display = "***" if has_value else None
                is_set = has_value
            else:
                display = parse_value(s.value, s.value_type)
                is_set = s.value is not None and s.value != ""

            cat_settings.append(
                {
                    "id": s.id,
                    "category": s.category,
                    "key": s.key,
                    "value": display,
                    "is_set": is_set,
                    "value_type": s.value_type,
                    "is_sensitive": s.is_sensitive,
                    "is_editable": s.is_editable,
                    "description": (s.description_en or s.description) if lang == "en" else s.description,
                    "default_value": s.default_value,
                    "updated_at": s.updated_at,
                    "updated_by": s.updated_by,
                }
            )

        meta = (CATEGORY_META_EN if lang == "en" else CATEGORY_META).get(cat, {"title": cat, "description": None})
        categories.append(
            {
                "category": cat,
                "title": meta["title"],
                "description": meta.get("description"),
                "settings": cat_settings,
            }
        )

    return {"categories": categories}


# === Cluster settings sync (master -> slave) — eklenmistir ===
SYNC_CATEGORIES: set[str] = {
    "password", "password_policy", "password_reset", "sms", "mfa",
    "security", "lockout", "branding", "smtp",
}


async def export_settings(
    db: AsyncSession, categories: set[str] | None = None
) -> list[dict[str, Any]]:
    """Slave senkronizasyonu icin HAM ayar degerlerini doner.

    Hassas degerler COZULUP duz metin olarak doner (slave kendi Fernet
    anahtariyla yeniden sifreler). Sadece var olan satirlar doner —
    upsert-only kaynak; master'da olmayan key slave'de silinmez.
    """
    cats = categories or SYNC_CATEGORIES
    stmt = (
        select(SystemSetting)
        .where(SystemSetting.category.in_(cats))
        .order_by(SystemSetting.category, SystemSetting.key)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    fernet = None
    out: list[dict[str, Any]] = []
    for s in rows:
        if s.is_sensitive:
            value = None
            if s.encrypted_value:
                try:
                    if fernet is None:
                        fernet = _get_fernet()
                    value = fernet.decrypt(s.encrypted_value.encode()).decode()
                except Exception:  # noqa: BLE001
                    value = None  # cozulemezse degeri gonderme
        else:
            value = s.value
        out.append(
            {
                "category": s.category,
                "key": s.key,
                "value": value,
                "value_type": s.value_type,
                "is_sensitive": bool(s.is_sensitive),
                "is_editable": bool(s.is_editable),
                "description": s.description,
                "description_en": getattr(s, "description_en", None),
                "default_value": s.default_value,
            }
        )
    return out


async def update_setting(
    db: AsyncSession,
    category: str,
    key: str,
    new_value: Any,
    actor_id: UUID,
) -> tuple[SystemSetting, Any, Any]:
    """(model, old_display, new_display) döner. Caller commit + audit log'lar."""
    s = await get_setting(db, category, key)

    if not s.is_editable:
        raise ValidationError("Bu ayar düzenlenemez", code="SETTING_READ_ONLY")

    validate_value(s.key, new_value, s.value_type)

    # Audit için display (hassas maskelenir)
    if s.is_sensitive:
        old_display = "***" if s.encrypted_value else None
        new_display = "***" if new_value not in (None, "") else None
    else:
        old_display = parse_value(s.value, s.value_type)
        new_display = new_value

    serialized = serialize_value(new_value, s.value_type)

    if s.is_sensitive:
        if serialized:
            s.encrypted_value = _get_fernet().encrypt(serialized.encode()).decode()
            s.value = None
        else:
            s.encrypted_value = None
    else:
        s.value = serialized if serialized != "" else None

    s.updated_by = actor_id
    await db.flush()

    # --- password.min_length -> LDAP ppolicy pwdMinLength otomatik senkron ---
    # Tek kaynak = Settings. LDAP pwdMinLength her zaman bu degeri yansitir.
    # Best-effort: LDAP erisilemezse Settings kaydi yine de gecerli kalir.
    if category == "password_policy" and key == "password.min_length":
        try:
            from app.core.ldap import get_ldap
            from app.core.config import get_settings as _gs
            from ldap3 import MODIFY_REPLACE
            _minlen = int(new_value)
            _base = _gs().ldap_base_dn
            _policy_dn = f"cn=default,ou=policies,{_base}"
            with get_ldap().write() as _conn:
                _conn.modify(_policy_dn, {"pwdMinLength": [(MODIFY_REPLACE, [str(_minlen)])]})
            logger.info("settings.pwdminlength_synced", value=_minlen, dn=_policy_dn)
        except Exception as _e:  # noqa: BLE001
            logger.warning("settings.pwdminlength_sync_failed", error=str(_e))

    return s, old_display, new_display


# ---------------------------------------------------------------------------
# SMTP test
# ---------------------------------------------------------------------------
async def send_smtp_test(db: AsyncSession, to_email: str) -> None:
    """Mevcut SMTP ayarlarıyla test maili gönder. SMTPException + bağlantı hatalarını
    ValidationError'a sarar — caller doğrudan kullanıcıya gösterir."""
    enabled = await get_value(db, "smtp", "smtp.enabled")
    if not enabled:
        raise ValidationError(
            "SMTP devre dışı — önce 'smtp.enabled' = true yapın",
            code="SMTP_DISABLED",
        )

    host = await get_value(db, "smtp", "smtp.host")
    port = await get_value(db, "smtp", "smtp.port") or 587
    use_tls = await get_value(db, "smtp", "smtp.use_tls")
    use_ssl = await get_value(db, "smtp", "smtp.use_ssl")
    username = await get_value(db, "smtp", "smtp.username") or ""
    password = await get_value(db, "smtp", "smtp.password") or ""
    from_email = await get_value(db, "smtp", "smtp.from_email")
    from_name = await get_value(db, "smtp", "smtp.from_name") or "MTL Ldap"

    if not host:
        raise ValidationError("SMTP host yapılandırılmamış", code="SMTP_HOST_MISSING")
    if not from_email:
        raise ValidationError(
            "Gönderen e-posta adresi yapılandırılmamış", code="SMTP_FROM_MISSING"
        )

    msg = MIMEText(
        "Bu, MTL Ldap Admin SMTP yapılandırma test mailidir.\n\n"
        "Bu maili aldıysanız SMTP ayarlarınız doğru çalışıyor demektir.\n\n"
        "— MTL Ldap Admin",
        "plain",
        "utf-8",
    )
    msg["Subject"] = "MTL SMTP Test"
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to_email

    try:
        if use_ssl:
            client = smtplib.SMTP_SSL(host, int(port), timeout=15)
        else:
            client = smtplib.SMTP(host, int(port), timeout=15)
            if use_tls:
                client.starttls()
        if username:
            client.login(username, password)
        client.sendmail(from_email, [to_email], msg.as_string())
        try:
            client.quit()
        except Exception:
            pass
        logger.info("smtp.test_sent to=%s host=%s", to_email, host)
    except smtplib.SMTPAuthenticationError as e:
        raise ValidationError(
            f"SMTP kimlik doğrulama hatası: {e}", code="SMTP_AUTH_FAILED"
        ) from e
    except smtplib.SMTPException as e:
        raise ValidationError(
            f"SMTP gönderim hatası: {e}", code="SMTP_SEND_FAILED"
        ) from e
    except OSError as e:
        raise ValidationError(
            f"SMTP bağlantı hatası: {e}", code="SMTP_CONNECTION_FAILED"
        ) from e

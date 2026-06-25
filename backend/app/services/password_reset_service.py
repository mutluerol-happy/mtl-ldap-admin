# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
End-user parola reset servisi (slave-side).

Akış:
  1. request_reset(uid_or_email)
       → LDAP'te kullanıcıyı bul
       → OTP üret (6 haneli)
       → DB'ye SHA-256 hash kaydet (5 dk geçerli)
       → Throttling: aynı uid için son 1 dakikada >=1 talep varsa reddet
       → SMTP ile gönder

  2. verify_otp(uid, otp)
       → DB'den pending kayıt bul
       → expires kontrolü
       → attempt count + max_attempts kontrolü
       → OTP hash eşleşme
       → Başarılıysa: completion_token üret (10 dk), status=verified

  3. complete_reset(completion_token, new_password)
       → token'la kayıt bul, expires kontrolü
       → password policy uygula
       → LDAP entry'sine userPassword set
       → status=completed
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from ldap3 import MODIFY_REPLACE
from passlib.hash import ldap_salted_sha1
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.i18n import t
from app.core.exceptions import (
    AuthenticationError,
    NotFoundError,
    RateLimitError,
    ValidationError,
)
from app.core.ldap import LDAPError, get_ldap
from app.core.logging import get_logger
from app.models.password_reset import PasswordResetRequest, UserSelfServiceLog
from app.services import notification_service

logger = get_logger(__name__)

OTP_LENGTH = 6
OTP_TTL_MINUTES = 5
COMPLETION_TOKEN_TTL_MINUTES = 10
THROTTLE_WINDOW_SECONDS = 60  # 1 dakikada 1 talep limiti


# ============================================================================
# Yardımcılar
# ============================================================================


def _generate_otp() -> str:
    """6 haneli numerik OTP."""
    return "".join(secrets.choice("0123456789") for _ in range(OTP_LENGTH))


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _ldap_find_user(
    uid: str | None,
    email: str | None,
    phone: str | None = None,
    sms_attribute: str = "mobile",
) -> dict | None:
    """LDAP'te ou=people altında kullanıcıyı bul. uid/email/phone ile arama. Yoksa None."""
    settings = get_settings()
    ldap_client = get_ldap()

    if uid:
        filter_str = f"(&(objectClass=inetOrgPerson)(uid={uid}))"
    elif email:
        filter_str = f"(&(objectClass=inetOrgPerson)(mail={email}))"
    elif phone and sms_attribute:
        # LDAP injection koruması: sadece rakam ve + izin ver
        safe_phone = "".join(c for c in phone if c.isdigit() or c == "+")
        if not safe_phone:
            return None
        filter_str = f"(&(objectClass=inetOrgPerson)({sms_attribute}={safe_phone}))"
    else:
        return None

    base_dn = f"ou=people,{settings.ldap_base_dn}"
    attrs = ["uid", "cn", "mail", "displayName", "pwdReset"]
    if sms_attribute and sms_attribute not in attrs:
        attrs.append(sms_attribute)

    try:
        with ldap_client.read() as conn:
            conn.search(
                search_base=base_dn,
                search_filter=filter_str,
                attributes=attrs,
            )
            if not conn.entries:
                return None
            entry = conn.entries[0]
            phone_val = None
            if sms_attribute and hasattr(entry, sms_attribute):
                attr_val = getattr(entry, sms_attribute)
                phone_val = str(attr_val) if attr_val else None
            must_change = False
            if hasattr(entry, "pwdReset"):
                _pr = getattr(entry, "pwdReset")
                must_change = bool(_pr) and str(_pr).upper() == "TRUE"
            return {
                "dn": entry.entry_dn,
                "uid": str(entry.uid),
                "cn": str(entry.cn) if entry.cn else None,
                "mail": str(entry.mail) if entry.mail else None,
                "display_name": str(entry.displayName) if hasattr(entry, "displayName") and entry.displayName else None,
                "phone": phone_val,
                "must_change_password": must_change,
            }
    except LDAPError as e:
        logger.warning("password_reset.ldap_lookup_failed", error=str(e))
        return None


async def _log_event(
    db: AsyncSession,
    event_code: str,
    uid: str,
    *,
    email: str | None = None,
    successful: bool = True,
    ip: str | None = None,
    user_agent: str | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    extra: dict | None = None,
) -> None:
    """user_self_service_log'a kayıt at."""
    log = UserSelfServiceLog(
        event_code=event_code,
        target_uid=uid,
        target_email=email,
        successful=successful,
        ip_address=ip,
        user_agent=(user_agent or "")[:1024] or None,
        error_code=error_code,
        error_message=error_message,
        extra=extra or {},
    )
    db.add(log)
    await db.flush()


# ============================================================================
# Adım 1 — request_reset
# ============================================================================


async def request_reset(
    db: AsyncSession,
    uid: str | None,
    email: str | None,
    ip: str | None,
    user_agent: str | None,
    phone: str | None = None,
    channel: str | None = None,
) -> dict:
    """Reset OTP üretip ilgili kanaldan gönder. Account enumeration koruması: hep 200."""
    from app.services import settings_service as _settings_svc
    # Settings'ten kanal config oku
    try:
        cfg_channel = await _settings_svc.get_value(db, "password_reset", "password_reset.channel") or "email"
        cfg_sms_attr = await _settings_svc.get_value(db, "password_reset", "password_reset.sms_attribute") or "mobile"
    except Exception:
        cfg_channel, cfg_sms_attr = "email", "mobile"

    # Etkin kanal: cfg "both" ise user seçimi, değilse cfg
    if cfg_channel == "both":
        effective_channel = (channel or "email").lower()
    else:
        effective_channel = cfg_channel.lower()
    if effective_channel not in ("email", "sms"):
        effective_channel = "email"

    user = _ldap_find_user(uid, email, phone, sms_attribute=cfg_sms_attr)

    # Cross-check: uid + (email veya phone) birlikte verildiyse, LDAP attr ile eşleşmeli
    if user is not None and uid:
        cross_ok = True
        if effective_channel == "email" and email:
            if not user.get("mail") or user["mail"].lower() != email.lower():
                cross_ok = False
        elif effective_channel == "sms" and phone:
            db_p = "".join(c for c in (user.get("phone") or "") if c.isdigit())
            in_p = "".join(c for c in phone if c.isdigit())
            if not db_p or db_p != in_p:
                cross_ok = False
        if not cross_ok:
            await _log_event(
                db, "PASSWORD_RESET_REQUEST", uid=uid, email=email,
                successful=False, ip=ip, user_agent=user_agent,
                error_code="CONTACT_MISMATCH",
            )
            await db.commit()
            return {"accepted": True, "request_id": None}

    if user is None:
        # Kullanıcı yok ama log için anonymized uid göster
        await _log_event(
            db,
            "PASSWORD_RESET_REQUEST",
            uid=uid or email or phone or "unknown",
            email=email,
            successful=False,
            ip=ip,
            user_agent=user_agent,
            error_code="USER_NOT_FOUND",
        )
        await db.commit()
        return {"accepted": True, "request_id": None}

    real_uid = user["uid"]
    real_email = user.get("mail")

    # Throttling: aynı uid için son 1 dakikada bir talep var mı?
    threshold = datetime.now(timezone.utc) - timedelta(seconds=THROTTLE_WINDOW_SECONDS)
    recent_stmt = (
        select(func.count())
        .select_from(PasswordResetRequest)
        .where(
            PasswordResetRequest.target_uid == real_uid,
            PasswordResetRequest.issued_at >= threshold,
        )
    )
    recent_count = (await db.execute(recent_stmt)).scalar_one()
    if recent_count >= 1:
        await _log_event(
            db, "PASSWORD_RESET_REQUEST", uid=real_uid, email=real_email,
            successful=False, ip=ip, user_agent=user_agent,
            error_code="RATE_LIMITED",
        )
        await db.commit()
        raise RateLimitError(
            f"Çok sık talep — {THROTTLE_WINDOW_SECONDS} saniye bekleyin",
            code="RESET_RATE_LIMITED",
        )

    # OTP üret + kaydet
    otp = _generate_otp()
    request = PasswordResetRequest(
        target_uid=real_uid,
        target_email=real_email,
        target_ldap_dn=user["dn"],
        otp_hash=_hash_secret(otp),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES),
        request_ip=ip,
        request_user_agent=(user_agent or "")[:1024] or None,
    )
    db.add(request)
    await db.flush()

    # Kanal'a göre gönderim
    real_phone = user.get("phone")
    sent = False
    if effective_channel == "email" and real_email:
        sent = notification_service.send_password_reset_email(
            to=real_email, uid=real_uid, otp=otp, ttl_minutes=OTP_TTL_MINUTES
        )
        if not sent:
            logger.warning("password_reset.email_send_failed", uid=real_uid)
    elif effective_channel == "sms" and real_phone:
        # SMS metni Settings'ten (sms.message_template); bossa varsayilan sabit metin.
        _sms_tmpl = await _settings_svc.get_value(db, "sms", "sms.message_template")
        if _sms_tmpl:
            try:
                sms_text = (_sms_tmpl
                            .replace("{otp}", str(otp))
                            .replace("{ttl}", str(OTP_TTL_MINUTES))
                            .replace("{uid}", str(real_uid)))
            except Exception:  # noqa: BLE001
                sms_text = f"MTL parola sifirlama kodu: {otp}. {OTP_TTL_MINUTES} dakika gecerli."
        else:
            sms_text = f"MTL parola sifirlama kodu: {otp}. {OTP_TTL_MINUTES} dakika gecerli."
        try:
            from app.services import sms_service
            result = await sms_service.send_sms(db, to=real_phone, text=sms_text)
            sent = bool(result.get("ok"))
            if not sent:
                logger.warning("password_reset.sms_send_failed uid=%s err=%s", real_uid, result.get("error"))
        except Exception as e:
            logger.warning("password_reset.sms_exception uid=%s err=%s", real_uid, str(e))
    else:
        logger.warning(
            "password_reset.no_channel_match uid=%s channel=%s has_email=%s has_phone=%s",
            real_uid, effective_channel, bool(real_email), bool(real_phone),
        )

    await _log_event(
        db, "PASSWORD_RESET_REQUEST", uid=real_uid, email=real_email,
        successful=True, ip=ip, user_agent=user_agent,
        extra={"otp_ttl_seconds": OTP_TTL_MINUTES * 60},
    )
    await db.commit()

    settings = get_settings()
    # Production'da request_id sızdırılmaz; sadece test/dev modunda
    return {
        "accepted": True,
        "request_id": str(request.id) if not settings.is_production else None,
    }


# ============================================================================
# Adım 2 — verify_otp
# ============================================================================


async def verify_otp(
    db: AsyncSession,
    uid: str,
    otp: str,
    ip: str | None,
    user_agent: str | None,
    lang: str = "tr",
) -> dict:
    """OTP doğrula. Başarılıysa completion_token döndür."""
    now = datetime.now(timezone.utc)
    # En son pending kayıt
    stmt = (
        select(PasswordResetRequest)
        .where(
            PasswordResetRequest.target_uid == uid,
            PasswordResetRequest.status.in_(("pending", "verified")),
        )
        .order_by(PasswordResetRequest.issued_at.desc())
        .limit(1)
    )
    request = (await db.execute(stmt)).scalar_one_or_none()

    if request is None:
        await _log_event(
            db, "PASSWORD_RESET_VERIFY", uid=uid,
            successful=False, ip=ip, user_agent=user_agent,
            error_code="NO_PENDING_REQUEST",
        )
        await db.commit()
        raise NotFoundError(
            t("errors.resetRequestNotFound", lang),
            code="RESET_REQUEST_NOT_FOUND",
        )

    if request.status == "verified":
        # Zaten doğrulanmış, kullanıcı kafa karışıklığı yaşamış
        raise ValidationError(
            t("errors.resetAlreadyVerified", lang),
            code="ALREADY_VERIFIED",
        )

    if request.expires_at < now:
        request.status = "expired"
        await db.flush()
        await _log_event(
            db, "PASSWORD_RESET_VERIFY", uid=uid,
            successful=False, ip=ip, user_agent=user_agent,
            error_code="OTP_EXPIRED",
        )
        await db.commit()
        raise ValidationError(t("errors.otpExpired", lang), code="OTP_EXPIRED")

    if request.attempts >= request.max_attempts:
        request.status = "locked"
        await db.flush()
        await _log_event(
            db, "PASSWORD_RESET_VERIFY", uid=uid,
            successful=False, ip=ip, user_agent=user_agent,
            error_code="MAX_ATTEMPTS_EXCEEDED",
        )
        await db.commit()
        raise AuthenticationError(
            t("errors.otpLocked", lang),
            code="OTP_LOCKED",
        )

    request.attempts += 1
    if request.otp_hash != _hash_secret(otp):
        await db.flush()
        await _log_event(
            db, "PASSWORD_RESET_VERIFY", uid=uid,
            successful=False, ip=ip, user_agent=user_agent,
            error_code="OTP_INVALID",
            extra={"attempts_used": request.attempts, "attempts_max": request.max_attempts},
        )
        await db.commit()
        remaining = request.max_attempts - request.attempts
        raise AuthenticationError(
            t("errors.otpInvalid", lang).replace("{remaining}", str(remaining)),
            code="OTP_INVALID",
        )

    # Başarılı — completion_token üret
    completion_token = secrets.token_urlsafe(32)
    request.status = "verified"
    request.consumed_at = now
    request.completion_token_hash = _hash_secret(completion_token)
    request.completion_expires_at = now + timedelta(minutes=COMPLETION_TOKEN_TTL_MINUTES)
    await db.flush()

    await _log_event(
        db, "PASSWORD_RESET_VERIFY", uid=uid,
        successful=True, ip=ip, user_agent=user_agent,
    )
    await db.commit()

    return {
        "verified": True,
        "completion_token": completion_token,
        "expires_in": COMPLETION_TOKEN_TTL_MINUTES * 60,
    }


# ============================================================================
# Adım 3 — complete_reset
# ============================================================================


def _validate_password(password: str, uid: str | None = None) -> None:
    """DEPRECATED senkron sürüm — DEFAULT_POLICY kullanır.

    Yeni kod _validate_password_async kullanmalı.
    """
    from app.services.password_policy_service import DEFAULT_POLICY, validate_password
    validate_password(password, DEFAULT_POLICY, username=uid)


async def _validate_password_async(
    db, password: str, uid: str | None = None, lang: str = "tr"
) -> None:
    """Settings-driven password validation."""
    from app.services.password_policy_service import validate_password_async
    await validate_password_async(db, password, username=uid, lang=lang)


async def complete_reset(
    db: AsyncSession,
    completion_token: str,
    new_password: str,
    ip: str | None,
    user_agent: str | None,
    lang: str = "tr",
) -> dict:
    """Completion token ile parolayı LDAP'te güncelle."""
    now = datetime.now(timezone.utc)
    token_hash = _hash_secret(completion_token)

    stmt = (
        select(PasswordResetRequest)
        .where(
            PasswordResetRequest.completion_token_hash == token_hash,
            PasswordResetRequest.status == "verified",
        )
        .limit(1)
    )
    request = (await db.execute(stmt)).scalar_one_or_none()

    if request is None:
        raise AuthenticationError(
            t("errors.completionTokenInvalid", lang), code="COMPLETION_TOKEN_INVALID"
        )

    if request.completion_expires_at and request.completion_expires_at < now:
        request.status = "expired"
        await db.flush()
        await db.commit()
        raise ValidationError(
            t("errors.completionTokenExpired", lang),
            code="COMPLETION_TOKEN_EXPIRED",
        )

    # Parola politikası
    await _validate_password_async(db, new_password, request.target_uid)

    # LDAP'e yaz
    ldap_client = get_ldap()
    hashed = ldap_salted_sha1.hash(new_password)
    try:
        with ldap_client.write() as conn:
            ok = conn.modify(
                request.target_ldap_dn,
                {"userPassword": [(MODIFY_REPLACE, [hashed])]},
            )
            if not ok:
                raise LDAPError(f"LDAP modify başarısız: {conn.result}")
            # basarili -> 3. parti kilidini ac (shadow) + pwdReset temizle
            from app.services.ldap_user_service import _clear_shadow_lock
            _clear_shadow_lock(conn, request.target_ldap_dn, request.target_uid)
    except LDAPError as e:
        await _log_event(
            db, "PASSWORD_RESET_COMPLETE", uid=request.target_uid,
            email=request.target_email,
            successful=False, ip=ip, user_agent=user_agent,
            error_code="LDAP_UPDATE_FAILED", error_message=str(e),
        )
        await db.commit()
        raise

    request.status = "completed"
    request.completed_at = now
    await db.flush()

    await _log_event(
        db, "PASSWORD_RESET_COMPLETE", uid=request.target_uid,
        email=request.target_email,
        successful=True, ip=ip, user_agent=user_agent,
    )
    await db.commit()

    logger.info("password_reset.completed", uid=request.target_uid)
    return {"completed": True}


# ============================================================================
# Şifre politikası — UI'da gösterilecek
# ============================================================================


def get_password_policy() -> dict:
    """DEPRECATED senkron sürüm — DEFAULT_POLICY döner.

    Yeni kod get_password_policy_async(db) kullanmalı.
    """
    from app.services.password_policy_service import DEFAULT_POLICY
    p = dict(DEFAULT_POLICY)
    p["require_uppercase"] = p.get("require_upper", True)
    p["require_lowercase"] = p.get("require_lower", True)
    p["forbidden_substrings"] = ["uid", "password", "parola", "12345"]
    return p


async def get_password_policy_async(db) -> dict:
    """Settings'ten policy oku + reset kanal bilgisini ekle."""
    from app.services.password_policy_service import get_public_policy
    from app.services import settings_service as _settings_svc
    p = await get_public_policy(db)
    p["forbidden_substrings"] = ["uid", "password", "parola", "12345"]
    try:
        channel = await _settings_svc.get_value(db, "password_reset", "password_reset.channel")
        p["reset_channel"] = channel or "email"
    except Exception:
        p["reset_channel"] = "email"
    return p

# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
End-user authentication servisi (slave-side).

Admin login'den (auth_service.login) farkı:
  - LDAP bind ile parola doğrulanır (end_user'lar LDAP'te tutulur).
  - Roles/permissions yok — sadece self-service tokens.
  - MFA opsiyonel (end_user_mfa_secret tablosundan).
  - DB'de admin_account kaydı yok.
"""

from __future__ import annotations

import io
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import pyotp
import qrcode
from cryptography.fernet import Fernet
from ldap3 import Connection, MODIFY_REPLACE, Server, ALL
from passlib.hash import ldap_salted_sha1
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.i18n import t
from app.core.exceptions import (
    AuthenticationError,
    NotFoundError,
    ValidationError,
)
from app.core.ldap import LDAPError, get_ldap
from app.core.logging import get_logger
from app.core.redis_client import get_redis
from app.models.password_reset import EndUserMfaSecret, UserSelfServiceLog
from app.services.password_reset_service import _hash_secret, _ldap_find_user

logger = get_logger(__name__)


END_USER_ACCESS_TOKEN_TTL = 1800  # 30 dakika
END_USER_MFA_CHALLENGE_TTL = 300  # 5 dakika


# ============================================================================
# Fernet helpers
# ============================================================================


def _fernet() -> Fernet:
    settings = get_settings()
    return Fernet(settings.fernet_key.get_secret_value().encode())


def _encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def _decrypt_secret(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode()).decode()


# ============================================================================
# LDAP bind doğrulaması (parolanın gerçek doğrulayıcısı)
# ============================================================================


def _ldap_authenticate(dn: str, password: str) -> bool:
    """Geçici bağlantı ile DN+parola bind dene."""
    settings = get_settings()
    try:
        server = Server(settings.ldap_url, get_info=ALL)
        # auto_bind=True başarısızsa exception fırlatır
        conn = Connection(server, user=dn, password=password, auto_bind=True)
        conn.unbind()
        return True
    except Exception as e:  # noqa: BLE001
        logger.debug("end_user.ldap_bind_failed", dn=dn, error=str(e))
        return False


# ============================================================================
# Logging yardımcısı
# ============================================================================


async def _log(
    db: AsyncSession,
    event_code: str,
    uid: str,
    successful: bool,
    *,
    ip: str | None = None,
    user_agent: str | None = None,
    error_code: str | None = None,
    extra: dict | None = None,
) -> None:
    db.add(UserSelfServiceLog(
        event_code=event_code,
        target_uid=uid,
        successful=successful,
        ip_address=ip,
        user_agent=(user_agent or "")[:1024] or None,
        error_code=error_code,
        extra=extra or {},
    ))
    await db.flush()


# ============================================================================
# Login
# ============================================================================


async def login_end_user(
    db: AsyncSession,
    uid: str,
    password: str,
    ip: str | None,
    user_agent: str | None,
) -> dict:
    """End-user login. LDAP bind ile parola doğrula, MFA varsa challenge döndür."""
    user = _ldap_find_user(uid, None)
    if user is None:
        await _log(db, "END_USER_LOGIN", uid, False, ip=ip, user_agent=user_agent,
                   error_code="USER_NOT_FOUND")
        await db.commit()
        raise AuthenticationError("Kullanıcı adı veya parola hatalı",
                                  code="INVALID_CREDENTIALS")

    if not _ldap_authenticate(user["dn"], password):
        await _log(db, "END_USER_LOGIN", uid, False, ip=ip, user_agent=user_agent,
                   error_code="INVALID_PASSWORD")
        await db.commit()
        raise AuthenticationError("Kullanıcı adı veya parola hatalı",
                                  code="INVALID_CREDENTIALS")

    # MFA kontrolü
    mfa_stmt = select(EndUserMfaSecret).where(
        EndUserMfaSecret.target_uid == user["uid"],
        EndUserMfaSecret.enabled == True,  # noqa: E712
    )
    mfa = (await db.execute(mfa_stmt)).scalar_one_or_none()

    if mfa is not None:
        # MFA aktif — challenge üret
        challenge_id = secrets.token_urlsafe(32)
        redis = get_redis()
        await redis.setex(
            f"mtl:enduser:mfa:challenge:{challenge_id}",
            END_USER_MFA_CHALLENGE_TTL,
            user["uid"],
        )
        await _log(db, "END_USER_LOGIN_MFA_REQUIRED", uid, True, ip=ip,
                   user_agent=user_agent)
        await db.commit()
        return {
            "mfa_required": True,
            "mfa_challenge_id": challenge_id,
            "access_token": None,
            "user": None,
        }

    # MFA yok — direkt token ver
    return await _issue_end_user_token(
        db, user, ip=ip, user_agent=user_agent, mfa_used=False
    )


async def complete_mfa_challenge(
    db: AsyncSession,
    challenge_id: str,
    totp_code: str,
    ip: str | None,
    user_agent: str | None,
) -> dict:
    """MFA challenge sonrası TOTP doğrulama."""
    redis = get_redis()
    key = f"mtl:enduser:mfa:challenge:{challenge_id}"
    uid_raw = await redis.get(key)
    if not uid_raw:
        raise AuthenticationError("Challenge geçersiz veya süresi doldu",
                                  code="MFA_CHALLENGE_INVALID")
    uid = uid_raw.decode() if isinstance(uid_raw, bytes) else uid_raw

    mfa_stmt = select(EndUserMfaSecret).where(EndUserMfaSecret.target_uid == uid)
    mfa = (await db.execute(mfa_stmt)).scalar_one_or_none()
    if mfa is None or not mfa.enabled:
        raise AuthenticationError("MFA tanımlı değil", code="MFA_NOT_CONFIGURED")

    secret = _decrypt_secret(mfa.secret_encrypted)
    totp = pyotp.TOTP(secret)
    if not totp.verify(totp_code, valid_window=1):
        await _log(db, "END_USER_MFA_FAILED", uid, False, ip=ip,
                   user_agent=user_agent, error_code="MFA_INVALID")
        await db.commit()
        raise AuthenticationError("TOTP kodu geçersiz", code="MFA_FAILED")

    mfa.last_used_at = datetime.now(timezone.utc)
    await db.flush()
    await redis.delete(key)

    user = _ldap_find_user(uid, None)
    if user is None:
        raise NotFoundError("Kullanıcı LDAP'te bulunamadı", code="USER_NOT_FOUND")

    return await _issue_end_user_token(
        db, user, ip=ip, user_agent=user_agent, mfa_used=True
    )


async def _issue_end_user_token(
    db: AsyncSession,
    user: dict,
    *,
    ip: str | None,
    user_agent: str | None,
    mfa_used: bool,
) -> dict:
    """End-user için JWT-benzeri opaque token üret (Redis'te tutulur)."""
    token = secrets.token_urlsafe(32)
    redis = get_redis()
    await redis.setex(
        f"mtl:enduser:token:{token}",
        END_USER_ACCESS_TOKEN_TTL,
        user["uid"],
    )

    mfa_stmt = select(EndUserMfaSecret).where(
        EndUserMfaSecret.target_uid == user["uid"],
        EndUserMfaSecret.enabled == True,  # noqa: E712
    )
    has_mfa = (await db.execute(mfa_stmt)).scalar_one_or_none() is not None

    await _log(db, "END_USER_LOGIN", user["uid"], True, ip=ip, user_agent=user_agent,
               extra={"mfa_used": mfa_used})
    await db.commit()

    return {
        "mfa_required": False,
        "must_change_password": user.get("must_change_password", False),
        "access_token": token,
        "expires_in": END_USER_ACCESS_TOKEN_TTL,
        "user": {
            "uid": user["uid"],
            "cn": user.get("cn"),
            "display_name": user.get("display_name"),
            "email": user.get("mail"),
            "mfa_enabled": has_mfa,
            "must_change_password": user.get("must_change_password", False),
        },
    }


async def resolve_end_user_token(token: str) -> str:
    """Token → uid. Geçersizse exception."""
    redis = get_redis()
    raw = await redis.get(f"mtl:enduser:token:{token}")
    if not raw:
        raise AuthenticationError("Token geçersiz veya süresi doldu",
                                  code="TOKEN_INVALID")
    return raw.decode() if isinstance(raw, bytes) else raw


async def logout_end_user(token: str) -> None:
    redis = get_redis()
    await redis.delete(f"mtl:enduser:token:{token}")


# ============================================================================
# MFA enroll (end_user kendi yapar)
# ============================================================================


async def setup_mfa_for_end_user(db: AsyncSession, uid: str) -> dict:
    """TOTP secret üret, enabled=False olarak kaydet (verify ile aktive olur)."""
    settings = get_settings()
    user = _ldap_find_user(uid, None)
    if user is None:
        raise NotFoundError(t("errors.userNotFound", lang), code="USER_NOT_FOUND")

    secret = pyotp.random_base32()
    encrypted = _encrypt_secret(secret)

    stmt = select(EndUserMfaSecret).where(EndUserMfaSecret.target_uid == uid)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        if existing.enabled:
            raise ValidationError("MFA zaten aktif — önce devre dışı bırakın",
                                  code="MFA_ALREADY_ENABLED")
        existing.secret_encrypted = encrypted
        existing.enrolled_at = None
    else:
        record = EndUserMfaSecret(
            target_uid=uid,
            secret_encrypted=encrypted,
            enabled=False,
        )
        db.add(record)
    await db.flush()
    await db.commit()

    totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
        name=user["uid"],
        issuer_name=f"MTL Parola Reset ({settings.node_id})",
    )

    # QR code üret
    img = qrcode.make(totp_uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    import base64
    qr_data_uri = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"

    return {
        "secret": secret,
        "qr_code_url": totp_uri,
        "qr_code_data_uri": qr_data_uri,
    }


async def verify_and_enable_mfa(
    db: AsyncSession, uid: str, totp_code: str
) -> dict:
    """Enroll'lu secret'ı doğrula, enabled=True yap."""
    stmt = select(EndUserMfaSecret).where(EndUserMfaSecret.target_uid == uid)
    record = (await db.execute(stmt)).scalar_one_or_none()
    if record is None:
        raise NotFoundError("MFA enrollment bulunamadı — önce setup yapın",
                            code="MFA_NOT_ENROLLED")
    if record.enabled:
        raise ValidationError("MFA zaten aktif", code="MFA_ALREADY_ENABLED")

    secret = _decrypt_secret(record.secret_encrypted)
    if not pyotp.TOTP(secret).verify(totp_code, valid_window=1):
        raise AuthenticationError("TOTP kodu geçersiz", code="MFA_INVALID")

    record.enabled = True
    record.enrolled_at = datetime.now(timezone.utc)
    await db.flush()
    await db.commit()

    logger.info("end_user.mfa_enabled", uid=uid)
    return {"enabled": True, "enrolled_at": record.enrolled_at.isoformat()}


async def disable_mfa(db: AsyncSession, uid: str, totp_code: str) -> dict:
    """MFA kapatma — kendi TOTP'siyle doğrulamak gerek."""
    stmt = select(EndUserMfaSecret).where(EndUserMfaSecret.target_uid == uid)
    record = (await db.execute(stmt)).scalar_one_or_none()
    if record is None or not record.enabled:
        raise NotFoundError("MFA aktif değil", code="MFA_NOT_ENABLED")

    secret = _decrypt_secret(record.secret_encrypted)
    if not pyotp.TOTP(secret).verify(totp_code, valid_window=1):
        raise AuthenticationError("TOTP kodu geçersiz", code="MFA_INVALID")

    await db.delete(record)
    await db.flush()
    await db.commit()
    return {"disabled": True}


# ============================================================================
# Change password (giriş yapmış end_user için)
# ============================================================================


async def change_password(
    db: AsyncSession,
    uid: str,
    current_password: str,
    new_password: str,
    ip: str | None,
    user_agent: str | None,
    lang: str = "tr",
) -> dict:
    """End-user'ın kendi parolasını değiştirmesi."""
    from app.services.password_reset_service import _validate_password_async

    user = _ldap_find_user(uid, None)
    if user is None:
        raise NotFoundError(t("errors.userNotFound", lang), code="USER_NOT_FOUND")

    # Mevcut parola doğrulama
    if not _ldap_authenticate(user["dn"], current_password):
        await _log(db, "END_USER_PASSWORD_CHANGE", uid, False, ip=ip,
                   user_agent=user_agent, error_code="CURRENT_PASSWORD_INVALID")
        await db.commit()
        raise ValidationError(t("errors.currentPasswordInvalid", lang),
                              code="CURRENT_PASSWORD_INVALID")

    # Yeni parola politikası
    await _validate_password_async(db, new_password, uid, lang=lang)
    if current_password == new_password:
        raise ValidationError(t("errors.passwordSameAsOld", lang),
                              code="PASSWORD_SAME_AS_OLD")

    # LDAP güncelle
    ldap_client = get_ldap()
    hashed = ldap_salted_sha1.hash(new_password)
    try:
        with ldap_client.write() as conn:
            ok = conn.modify(
                user["dn"],
                {"userPassword": [(MODIFY_REPLACE, [hashed])]},
            )
            if not ok:
                raise LDAPError(f"LDAP modify başarısız: {conn.result}")
            # basarili -> 3. parti kilidini ac (shadow) + pwdReset temizle
            from app.services.ldap_user_service import _clear_shadow_lock
            _clear_shadow_lock(conn, user["dn"], uid)
    except LDAPError as e:
        await _log(db, "END_USER_PASSWORD_CHANGE", uid, False, ip=ip,
                   user_agent=user_agent, error_code="LDAP_UPDATE_FAILED")
        await db.commit()
        raise

    await _log(db, "END_USER_PASSWORD_CHANGE", uid, True, ip=ip, user_agent=user_agent)
    await db.commit()
    logger.info("end_user.password_changed", uid=uid)
    return {"completed": True}

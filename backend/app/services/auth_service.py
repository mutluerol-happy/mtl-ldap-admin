# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Auth orkestrasyon (AdminAccount tabanlı).

Login flow:
  1. username ile AdminAccount bul
  2. password_hash'i bcrypt verify
  3. is_locked kontrolü
  4. Başarısız → counter++ + audit
  5. MFA kontrolü:
       - aktif: challenge dön
       - rol gerektiriyor + setup yok: mfa_setup_token dön
       - hiçbir şart yok veya MFA aktif: tokens dön
  6. Audit + last_login_at
"""

from __future__ import annotations
from sqlalchemy import select

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError, ConflictError
from app.core.logging import get_logger
from app.core.redis_client import get_redis
from app.core.security import decrypt, encrypt, verify_password
from app.models.admin import AdminAccount
from app.schemas.auth import AdminPublic, LoginResponse, RolePublic, TokenPair
from app.services import audit_service, jwt_service, mfa
from app.services.admin_service import (
    admin_requires_mfa,
    get_admin_by_id,
    get_admin_by_username,
    get_admin_permissions,
    get_admin_roles,
    is_locked,
    register_failed_login,
    register_successful_login,
)

logger = get_logger(__name__)

# Setup token süresi — kullanıcı MFA enrollment'ı tamamlayana kadar
MFA_SETUP_TOKEN_TTL = 600  # 10 dakika


async def login(
    db: AsyncSession,
    username: str,
    password: str,
    ip: str | None = None,
    user_agent: str | None = None,
    request_id: str | None = None,
) -> LoginResponse:
    """Login flow — AdminAccount tabanlı."""
    settings = get_settings()
    username = username.strip().lower()

    # 1) Admin'i bul
    admin = await get_admin_by_username(db, username)
    if admin is None:
        await audit_service.log_login_attempt(
            db, username=username, successful=False, actor_id=None,
            failure_reason="user_not_found", ip_address=ip, user_agent=user_agent,
            request_id=request_id,
        )
        await db.commit()
        # Bilgi sızdırmamak için generic mesaj
        raise AuthenticationError("Kullanıcı adı veya parola hatalı", code="INVALID_CREDENTIALS")

    actor_id = str(admin.id)

    # 2) Aktif mi?
    if not admin.is_active:
        await audit_service.log_login_attempt(
            db, username=username, successful=False, actor_id=actor_id,
            failure_reason="user_inactive", ip_address=ip, user_agent=user_agent,
            request_id=request_id,
        )
        await db.commit()
        raise AuthenticationError("Hesap devre dışı", code="USER_INACTIVE")

    # 3) Kilitli mi?
    if is_locked(admin):
        await audit_service.log_login_attempt(
            db, username=username, successful=False, actor_id=actor_id,
            failure_reason="user_locked", ip_address=ip, user_agent=user_agent,
            request_id=request_id,
        )
        await db.commit()
        raise AuthenticationError(
            "Hesap geçici olarak kilitli, lütfen daha sonra deneyin",
            code="USER_LOCKED",
            details={"locked_until": admin.locked_until.isoformat() if admin.locked_until else None},
        )

    # 4) Parolayı doğrula — LDAP-auth admin'ler ldap_dn'e simple-bind ile, digerleri password_hash ile.
    _auth_source = (admin.security_flags or {}).get("auth_source")
    if _auth_source == "ldap" and admin.ldap_dn:
        from app.core.ldap import get_ldap
        # Bos parola LDAP'te anonymous/unauthenticated bind'e kacabilir -> pesinen reddet.
        _pw_ok = bool(password) and get_ldap().bind_as(admin.ldap_dn, password)
    else:
        _pw_ok = verify_password(password, admin.password_hash)
    if not _pw_ok:
        await register_failed_login(db, admin)
        await audit_service.log_login_attempt(
            db, username=username, successful=False, actor_id=actor_id,
            failure_reason="invalid_password", ip_address=ip, user_agent=user_agent,
            request_id=request_id,
        )
        await db.commit()
        raise AuthenticationError("Kullanıcı adı veya parola hatalı", code="INVALID_CREDENTIALS")

    # 5) MFA durumu
    mfa_required_by_role = admin_requires_mfa(admin)
    mfa_active = admin.mfa_enabled and admin.mfa_secret_encrypted

    # 5a) MFA zorunlu ama setup yapılmamış → setup token ver
    if mfa_required_by_role and not mfa_active:
        setup_token = await _issue_mfa_setup_token(admin)
        await audit_service.log_login_attempt(
            db, username=username, successful=True, actor_id=actor_id,
            failure_reason="mfa_setup_required", ip_address=ip, user_agent=user_agent,
            request_id=request_id,
        )
        await db.commit()
        logger.info("auth.login.mfa_setup_required", username=username)
        return LoginResponse(
            mfa_required=False,
            must_setup_mfa=True,
            mfa_setup_token=setup_token,
            tokens=None,
            user=None,
        )

    # 5b) MFA aktif → challenge ver
    if mfa_active:
        challenge_id = await _create_mfa_challenge(admin)
        await audit_service.log_login_attempt(
            db, username=username, successful=True, actor_id=actor_id,
            failure_reason="mfa_pending", ip_address=ip, user_agent=user_agent,
            request_id=request_id,
        )
        await db.commit()
        logger.info("auth.login.mfa_challenge_issued", username=username)
        return LoginResponse(
            mfa_required=True,
            mfa_challenge_id=challenge_id,
            tokens=None,
            user=None,
        )

    # 5c) MFA hiç gerek yok → tokens
    return await _finalize_login(db, admin, ip, user_agent, mfa_used=False, request_id=request_id)


async def complete_mfa_challenge(
    db: AsyncSession,
    challenge_id: str,
    totp_code: str,
    ip: str | None,
    user_agent: str | None,
    request_id: str | None = None,
) -> LoginResponse:
    """MFA challenge'ı tamamla."""
    admin_id_str = await _consume_mfa_challenge(challenge_id)
    try:
        admin_uuid = UUID(admin_id_str)
    except ValueError as e:
        raise AuthenticationError("Challenge bozuk", code="MFA_CHALLENGE_CORRUPT") from e

    admin = await get_admin_by_id(db, admin_uuid)
    if admin is None or not admin.is_active:
        raise AuthenticationError("Kullanıcı bulunamadı", code="USER_NOT_FOUND")

    if not admin.mfa_secret_encrypted:
        raise AuthenticationError("MFA secret yok", code="MFA_NOT_CONFIGURED")

    # Replay
    if await mfa.is_code_already_used(admin_id_str, totp_code):
        await audit_service.log_login_attempt(
            db, username=admin.username, successful=False, actor_id=admin_id_str,
            failure_reason="mfa_code_reused", mfa_used=True,
            ip_address=ip, user_agent=user_agent, request_id=request_id,
        )
        await db.commit()
        raise AuthenticationError("Bu kod zaten kullanıldı", code="MFA_CODE_REUSED")

    # Decrypt + verify
    try:
        secret = decrypt(admin.mfa_secret_encrypted)
    except ValueError as e:
        logger.error("auth.mfa.decrypt_failed", username=admin.username, error=str(e))
        raise AuthenticationError("MFA secret bozuk, yöneticiye başvurun", code="MFA_CORRUPT") from e

    if not mfa.verify_totp(secret, totp_code):
        await register_failed_login(db, admin)
        await audit_service.log_login_attempt(
            db, username=admin.username, successful=False, actor_id=admin_id_str,
            failure_reason="mfa_invalid", mfa_used=True,
            ip_address=ip, user_agent=user_agent, request_id=request_id,
        )
        await db.commit()
        raise AuthenticationError("MFA kodu yanlış", code="MFA_INVALID")

    await mfa.mark_code_used(admin_id_str, totp_code)
    return await _finalize_login(db, admin, ip, user_agent, mfa_used=True, request_id=request_id)


async def refresh_tokens(db: AsyncSession, refresh_token: str) -> TokenPair:
    """Refresh rotation."""
    payload = await jwt_service.verify_refresh_and_get_payload(refresh_token)
    admin_id_str = payload["sub"]
    old_jti = payload["jti"]
    old_exp = payload["exp"]

    try:
        admin_uuid = UUID(admin_id_str)
    except ValueError as e:
        raise AuthenticationError("Token bozuk", code="TOKEN_CORRUPT") from e

    admin = await get_admin_by_id(db, admin_uuid)
    if admin is None or not admin.is_active:
        raise AuthenticationError("Kullanıcı bulunamadı", code="USER_NOT_FOUND")

    # Eskisini blacklist
    await jwt_service.blacklist_refresh_token(old_jti, old_exp)

    # Yenisi
    roles = [r.name for r in get_admin_roles(admin)]
    perms = list(get_admin_permissions(admin))
    access, _ = jwt_service.create_access_token(
        user_id=admin.id, ldap_uid=admin.username, roles=roles, permissions=perms
    )
    refresh, _, _ = jwt_service.create_refresh_token(admin.id, admin.username)

    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        expires_in=int(jwt_service.ACCESS_TOKEN_TTL.total_seconds()),
    )


async def logout(refresh_token: str) -> None:
    try:
        payload = jwt_service.decode_refresh_token(refresh_token)
    except AuthenticationError:
        return  # Idempotent
    await jwt_service.blacklist_refresh_token(payload["jti"], payload["exp"])


# ============================================================================
# MFA setup
# ============================================================================


async def consume_mfa_setup_token(token: str) -> UUID:
    """
    mfa_setup_token'ı doğrula ve sil. admin_id döner.

    Bu token kısa ömürlü, sadece /auth/mfa/setup + /auth/mfa/verify için.
    """
    redis = get_redis()
    key = _setup_token_key(token)
    admin_id = await redis.get(key)
    if not admin_id:
        raise AuthenticationError(
            "Setup token süresi dolmuş, tekrar login olun",
            code="MFA_SETUP_TOKEN_INVALID",
        )
    # Bekle bekle... silmiyoruz çünkü setup + verify iki ayrı çağrı.
    # Verify başarılı olunca silinecek.
    try:
        return UUID(admin_id)
    except ValueError as e:
        await redis.delete(key)
        raise AuthenticationError("Setup token bozuk", code="MFA_SETUP_TOKEN_CORRUPT") from e


async def setup_mfa_for_admin(db: AsyncSession, admin: AdminAccount) -> dict[str, Any]:
    """
    TOTP secret üret + QR kod döner. Henüz LDAP veya DB'ye YAZMAZ — verify gerekli.
    Pending: mtl_core.mfa_pending_enrollment tablosuna.
    """
    if admin.mfa_enabled and admin.mfa_secret_encrypted:
        raise ConflictError("MFA zaten aktif", code="MFA_ALREADY_ENABLED")

    secret = mfa.generate_secret()
    otpauth_uri = mfa.get_totp_uri(admin.username, secret)
    qr_data_uri = mfa.generate_qr_data_uri(otpauth_uri)
    recovery_codes = mfa.generate_recovery_codes()

    # Pending enrollment'a kaydet
    from datetime import timedelta

    from app.models.mfa import MfaPendingEnrollment

    # Eski pending varsa sil
    from sqlalchemy import delete, select

    await db.execute(
        delete(MfaPendingEnrollment).where(
            MfaPendingEnrollment.subject_type == "ADMIN",
            MfaPendingEnrollment.subject_id == str(admin.id),
        )
    )

    pending = MfaPendingEnrollment(
        subject_type="ADMIN",
        subject_id=str(admin.id),
        secret_encrypted=encrypt(secret),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(pending)
    await db.commit()

    logger.info("auth.mfa.setup_started", username=admin.username)
    return {
        "secret": secret,
        "qr_code_url": otpauth_uri,
        "qr_code_data_uri": qr_data_uri,
        "recovery_codes": recovery_codes,
    }


async def verify_and_enable_mfa(
    db: AsyncSession,
    admin: AdminAccount,
    totp_code: str,
    consume_setup_token: str | None = None,
) -> None:
    """
    Pending enrollment'tan secret oku, TOTP doğrula, başarılıysa admin_account'a taşı.

    Eğer consume_setup_token verilirse Redis'ten siler (ilk-login akışı).
    """
    from sqlalchemy import select

    from app.models.mfa import MfaPendingEnrollment

    stmt = select(MfaPendingEnrollment).where(
        MfaPendingEnrollment.subject_type == "ADMIN",
        MfaPendingEnrollment.subject_id == str(admin.id),
    )
    result = await db.execute(stmt)
    pending = result.scalar_one_or_none()
    if pending is None:
        raise AuthenticationError(
            "MFA setup oturumu yok veya süresi doldu, tekrar başlatın",
            code="MFA_SETUP_NOT_FOUND",
        )

    if pending.expires_at < datetime.now(timezone.utc):
        await db.delete(pending)
        await db.commit()
        raise AuthenticationError("Setup süresi doldu", code="MFA_SETUP_EXPIRED")

    try:
        secret = decrypt(pending.secret_encrypted)
    except ValueError as e:
        await db.delete(pending)
        await db.commit()
        raise AuthenticationError("Setup secret bozuk", code="MFA_CORRUPT") from e

    if not mfa.verify_totp(secret, totp_code):
        raise AuthenticationError("TOTP kodu yanlış", code="MFA_INVALID")

    # OK — admin_account'a taşı
    admin.mfa_secret_encrypted = pending.secret_encrypted  # zaten encrypted
    admin.mfa_enabled = True
    await db.delete(pending)
    await db.flush()
    await db.commit()

    # Setup token'ı sil (varsa)
    if consume_setup_token:
        redis = get_redis()
        await redis.delete(_setup_token_key(consume_setup_token))

    logger.info("auth.mfa.enabled", username=admin.username)


async def disable_mfa_for_admin(
    db: AsyncSession,
    admin: AdminAccount,
    totp_code: str,
) -> None:
    """Kendi MFA'sını kapatma — TOTP gerekli."""
    if not admin.mfa_enabled or not admin.mfa_secret_encrypted:
        return

    try:
        secret = decrypt(admin.mfa_secret_encrypted)
    except ValueError as e:
        raise AuthenticationError("MFA secret bozuk", code="MFA_CORRUPT") from e

    if not mfa.verify_totp(secret, totp_code):
        raise AuthenticationError("TOTP kodu yanlış", code="MFA_INVALID")

    admin.mfa_enabled = False
    admin.mfa_secret_encrypted = None
    await db.commit()
    logger.info("auth.mfa.disabled_by_self", username=admin.username)


# ============================================================================
# Internal helpers
# ============================================================================


async def _finalize_login(
    db: AsyncSession,
    admin: AdminAccount,
    ip: str | None,
    user_agent: str | None,
    mfa_used: bool,
    request_id: str | None = None,
) -> LoginResponse:
    """Token üret + last_login + audit + commit.

    Tur 4: must_change_password=true ise normal token verme, sadece
    password_change_token döndür. Bu token sadece /auth/change-password'ü açar.
    """
    await register_successful_login(db, admin)
    await audit_service.log_login_attempt(
        db,
        username=admin.username,
        successful=True,
        actor_id=str(admin.id),
        mfa_used=mfa_used,
        ip_address=ip,
        user_agent=user_agent,
        request_id=request_id,
    )

    # Tur 4: must_change_password gate (+ parola expiry -> zorunlu degisim)
    if admin.must_change_password or await _admin_password_expired(db, admin):
        change_token = await issue_password_change_token(db, admin, ip, user_agent)
        await db.commit()
        logger.info("auth.login.must_change_password", username=admin.username)
        return LoginResponse(
            mfa_required=False,
            must_setup_mfa=False,
            tokens=None,
            user=None,
            password_change_required=True,
            password_change_token=change_token,
        )

    roles = [r.name for r in get_admin_roles(admin)]
    perms = list(get_admin_permissions(admin))

    access, _ = jwt_service.create_access_token(
        user_id=admin.id, ldap_uid=admin.username, roles=roles, permissions=perms
    )
    refresh, _, _ = jwt_service.create_refresh_token(admin.id, admin.username)
    token_pair = TokenPair(
        access_token=access,
        refresh_token=refresh,
        expires_in=int(jwt_service.ACCESS_TOKEN_TTL.total_seconds()),
    )

    role_publics = [
        RolePublic(
            id=r.id,
            name=r.name,
            description=r.description,
            is_system=r.is_system,
            requires_mfa=r.requires_mfa,
        )
        for r in get_admin_roles(admin)
    ]
    admin_public = AdminPublic(
        id=admin.id,
        username=admin.username,
        email=admin.email,
        display_name=admin.display_name,
        is_active=admin.is_active,
        mfa_enabled=admin.mfa_enabled,
        last_login_at=admin.last_login_at,
        roles=role_publics,
        permissions=sorted(perms),
    )
    await db.commit()
    logger.info("auth.login.success", username=admin.username, mfa_used=mfa_used)
    return LoginResponse(
        mfa_required=False,
        must_setup_mfa=False,
        tokens=token_pair,
        user=admin_public,
    )


# ============================================================================
# Tur 4: Password change token (must_change_password akışı için)
# ============================================================================

PASSWORD_CHANGE_TOKEN_TTL = 300  # 5 dakika


async def issue_password_change_token(
    db: AsyncSession,
    admin: AdminAccount,
    ip: str | None,
    user_agent: str | None,
) -> str:
    """Kullanıcının parolasını değiştirmesi için kısa ömürlü token yarat."""
    import hashlib

    from app.models.password_change_token import PasswordChangeToken

    plain = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(plain.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PASSWORD_CHANGE_TOKEN_TTL)

    record = PasswordChangeToken(
        admin_id=admin.id,
        token_hash=token_hash,
        expires_at=expires_at,
        issued_ip=ip,
        issued_user_agent=(user_agent or "")[:1024] or None,
    )
    db.add(record)
    await db.flush()
    return plain


async def consume_password_change_token(db: AsyncSession, token: str) -> UUID:
    """Token'ı doğrula, kullan, admin_id döndür."""
    import hashlib

    from app.models.password_change_token import PasswordChangeToken

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    stmt = select(PasswordChangeToken).where(PasswordChangeToken.token_hash == token_hash)
    record = (await db.execute(stmt)).scalar_one_or_none()
    if record is None:
        raise AuthenticationError(
            "Geçersiz parola değiştirme token'ı",
            code="PASSWORD_CHANGE_TOKEN_INVALID",
        )
    if record.consumed_at is not None:
        raise AuthenticationError(
            "Token zaten kullanılmış",
            code="PASSWORD_CHANGE_TOKEN_CONSUMED",
        )
    if record.expires_at < datetime.now(timezone.utc):
        raise AuthenticationError(
            "Token süresi dolmuş",
            code="PASSWORD_CHANGE_TOKEN_EXPIRED",
        )

    record.consumed_at = datetime.now(timezone.utc)
    await db.flush()
    return record.admin_id


def _setup_token_key(token: str) -> str:
    return f"mtl:auth:mfa:setup_token:{token}"


async def _issue_mfa_setup_token(admin: AdminAccount) -> str:
    """Kısıtlı yetkili token üret — sadece MFA setup endpoint'leri için."""
    token = secrets.token_urlsafe(32)
    redis = get_redis()
    await redis.setex(_setup_token_key(token), MFA_SETUP_TOKEN_TTL, str(admin.id))
    return token


def _challenge_key(challenge_id: str) -> str:
    return f"mtl:auth:mfa:challenge:{challenge_id}"


async def _create_mfa_challenge(admin: AdminAccount) -> str:
    """Login sonrası TOTP istenecek challenge id üret."""
    challenge_id = secrets.token_urlsafe(32)
    redis = get_redis()
    await redis.setex(_challenge_key(challenge_id), 300, str(admin.id))  # 5 dakika
    return challenge_id


async def _consume_mfa_challenge(challenge_id: str) -> str:
    redis = get_redis()
    key = _challenge_key(challenge_id)
    admin_id = await redis.get(key)
    if not admin_id:
        raise AuthenticationError("Challenge geçersiz veya süresi doldu",
                                  code="MFA_CHALLENGE_INVALID")
    await redis.delete(key)
    return admin_id


async def _admin_password_expired(db: AsyncSession, admin: AdminAccount) -> bool:
    """password_policy.max_age_days > 0 ve admin parola yasi >= max_age ise True.

    Login'deki must_change_password gate'ine baglanir. Parola degisimi
    password_changed_at'i now yaptigindan tekrar tetiklenmez (dongu yok).
    password_changed_at None ise (hic degismemis) zorlama yapilmaz.
    """
    try:
        from app.models.setting import SystemSetting

        rows = (
            await db.execute(
                select(SystemSetting).where(SystemSetting.category == "password_policy")
            )
        ).scalars().all()
        max_age = 0
        for r in rows:
            if str(r.key).endswith("max_age_days"):
                try:
                    max_age = int(r.value) if r.value not in (None, "") else 0
                except (ValueError, TypeError):
                    max_age = 0
                break
    except Exception:
        return False
    if max_age <= 0:
        return False
    changed = admin.password_changed_at or admin.created_at
    if changed is None:
        return False
    if changed.tzinfo is None:
        changed = changed.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - changed).days >= max_age

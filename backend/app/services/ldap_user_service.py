# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
LDAP end-user CRUD servisi.

Çalışma kuralları:
  - Yalnızca master LDAP'e yazar (slave read-only, replikasyon ile gelir).
  - Parolayı {SSHA} hash'leyerek yazar.
  - mtlPersonExtension auxiliary class kullanılır (mtlMfaSecret, mtlMfaEnabled,
    mtlPreferredLanguage, mtlSecurityFlags).
  - DB metadata kaydı paralel olarak oluşur/güncellenir.

Hata durumunda LDAP→DB veya DB→LDAP yan-etki bırakmayız:
  - Önce LDAP'e yaz, başarılıysa DB metadata oluştur.
  - DB başarısız olursa LDAP rollback yapılmaz (LDAP transactional değil).
    Bu durumda sync_discrepancy kaydı düşülür, bir sonraki cron temizler.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from ldap3 import MODIFY_ADD, MODIFY_REPLACE
from passlib.hash import ldap_salted_sha1
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.ldap import LDAPError, get_ldap
from app.core.logging import get_logger
from app.models.user_metadata import UserMetadata
from app.schemas.users import UserCreateRequest, UserPublic, UserUpdateRequest

logger = get_logger(__name__)


def _shadow_today_days() -> str:
    import time
    return str(int(time.time() // 86400))


def _set_shadow_lock(conn, dn: str, uid: str) -> None:
    """3. parti POSIX uygulama kilidi: hesabi POSIX-expired yap (shadowExpire=1).
    QNAP/pam reddeder; MTL LDAP bind'i shadow'a bakmadigindan kullanici MTL'ye
    girip parolasini degistirebilir. Best-effort (sema/izin sorununda parola
    degisimini bozmaz)."""
    try:
        # shadowAccount aux class garanti (varsa err=20 doner, yutulur)
        conn.modify(dn, {"objectClass": [(MODIFY_ADD, ["shadowAccount"])]})
        conn.modify(dn, {"shadowExpire": [(MODIFY_REPLACE, ["1"])]})
        conn.modify(dn, {"pwdAccountLockedTime": [(MODIFY_REPLACE, ["000001010000Z"])]})
        logger.info("ldap.user.shadow_locked", uid=uid)
    except Exception as _e:  # noqa: BLE001
        logger.warning("ldap.user.shadow_lock_failed", uid=uid, error=str(_e))


def _clear_shadow_lock(conn, dn: str, uid: str) -> None:
    """Parola degisti / zorlama kalkti -> kilidi ac: shadowExpire kaldir +
    shadowLastChange=bugun + pwdReset temizle. Best-effort."""
    today = _shadow_today_days()
    try:
        conn.modify(dn, {"objectClass": [(MODIFY_ADD, ["shadowAccount"])]})
        conn.modify(dn, {
            "shadowExpire": [(MODIFY_REPLACE, [])],
            "shadowLastChange": [(MODIFY_REPLACE, [today])],
        })
        conn.modify(dn, {"pwdReset": [(MODIFY_REPLACE, [])]})
        conn.modify(dn, {"pwdAccountLockedTime": [(MODIFY_REPLACE, [])]})
        logger.info("ldap.user.shadow_unlocked", uid=uid)
    except Exception as _e:  # noqa: BLE001
        logger.warning("ldap.user.shadow_unlock_failed", uid=uid, error=str(_e))


# ============================================================================
# Helpers
# ============================================================================


def _people_ou() -> str:
    settings = get_settings()
    return f"ou=people,{settings.ldap_base_dn}"


def _user_dn(uid: str) -> str:
    return f"uid={uid},{_people_ou()}"


def _hash_password_for_ldap(password: str) -> str:
    """{SSHA} formatında — master kurulumla aynı."""
    return ldap_salted_sha1.hash(password)


def _ldap_entry_to_public(
    entry_dn: str,
    attrs: dict[str, Any],
    metadata: UserMetadata | None,
) -> UserPublic:
    """LDAP entry + DB metadata → UserPublic."""

    def first(key: str) -> str | None:
        v = attrs.get(key)
        if v is None:
            return None
        if isinstance(v, (list, tuple)):
            return str(v[0]) if v else None
        return str(v)

    return UserPublic(
        uid=first("uid") or "",
        dn=entry_dn,
        cn=first("cn") or "",
        sn=first("sn"),
        given_name=first("givenName"),
        display_name=first("displayName"),
        email=first("mail"),
        phone=first("telephoneNumber"),
        title=first("title"),
        department=first("departmentNumber") or first("ou"),
        preferred_language=first("mtlPreferredLanguage"),
        # DB metadata
        metadata_id=metadata.id if metadata else None,
        is_active=metadata.is_active if metadata else True,
        is_locked=metadata.is_locked if metadata else False,
        locked_until=metadata.locked_until if metadata else None,
        failed_login_count=metadata.failed_login_count if metadata else 0,
        mfa_enabled=metadata.mfa_enabled if metadata
                    else str(first("mtlMfaEnabled") or "FALSE").upper() == "TRUE",
        mfa_enrolled_at=metadata.mfa_enrolled_at if metadata else None,
        last_login_at=metadata.last_login_at if metadata else None,
        last_login_ip=str(metadata.last_login_ip) if metadata and metadata.last_login_ip else None,
        must_change_password=metadata.must_change_password if metadata else False,
        password_changed_at=metadata.password_changed_at if metadata else None,
        password_expires_at=metadata.password_expires_at if metadata else None,
        security_flags=metadata.security_flags if metadata else {},
        ldap_sync_status=metadata.ldap_sync_status if metadata else "in_sync",
    )


# ============================================================================
# Create
# ============================================================================


async def create_user(
    db: AsyncSession,
    payload: UserCreateRequest,
    created_by: UUID | None = None,
) -> UserPublic:
    """LDAP'e user yarat + DB metadata oluştur."""
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("User oluşturma yalnızca master sunucuda", code="READ_ONLY")

    dn = _user_dn(payload.uid)
    ldap_client = get_ldap()

    # LDAP'te zaten var mı?
    try:
        existing = ldap_client.search_user_by_uid(payload.uid)
    except LDAPError as e:
        raise ValidationError(f"LDAP erişim hatası: {e}", code="LDAP_ERROR") from e

    if existing is not None:
        raise ConflictError(f"'{payload.uid}' uid'li kullanıcı zaten LDAP'te var", code="UID_EXISTS")

    # DB'de metadata var mı?
    stmt = select(UserMetadata).where(UserMetadata.ldap_uid == payload.uid)
    result = await db.execute(stmt)
    if result.scalar_one_or_none() is not None:
        raise ConflictError(f"'{payload.uid}' DB metadata'da zaten var", code="UID_EXISTS_DB")

    # LDAP entry'sini hazırla
    object_classes = ["inetOrgPerson", "mtlPersonExtension"]
    attrs: dict[str, Any] = {
        "uid": payload.uid,
        "cn": payload.cn,
        "sn": payload.sn,
        "userPassword": _hash_password_for_ldap(payload.password),
        "mtlMfaEnabled": "FALSE",
        "mtlPreferredLanguage": payload.preferred_language,
        "mtlSecurityFlags": "ACTIVE",
    }
    if payload.given_name:
        attrs["givenName"] = payload.given_name
    if payload.display_name:
        attrs["displayName"] = payload.display_name
    if payload.email:
        attrs["mail"] = payload.email
    if payload.phone:
        attrs["telephoneNumber"] = payload.phone
    if payload.title:
        attrs["title"] = payload.title
    if payload.department:
        attrs["departmentNumber"] = payload.department

    # LDAP add
    with ldap_client.write() as conn:
        ok = conn.add(dn, object_classes, attrs)
        if not ok:
            err = conn.result
            raise ValidationError(
                f"LDAP add başarısız: {err.get('description')}",
                code="LDAP_ADD_FAILED",
                details={"ldap_result": err},
            )

    logger.info("ldap.user.created", uid=payload.uid, dn=dn, created_by=str(created_by) if created_by else None)

    # DB metadata
    now = datetime.now(timezone.utc)
    meta = UserMetadata(
        ldap_uid=payload.uid,
        ldap_dn=dn,
        email=payload.email,
        display_name=payload.display_name or payload.cn,
        is_active=True,
        must_change_password=payload.must_change_password,
        password_changed_at=now,
        security_flags={"preferred_language": payload.preferred_language},
        created_by=created_by,
        updated_by=created_by,
        ldap_last_synced_at=now,
        ldap_sync_status="in_sync",
    )
    db.add(meta)
    await db.flush()

    # Public yanıt
    return _ldap_entry_to_public(dn, attrs, meta)


# ============================================================================
# Read
# ============================================================================


async def get_user(db: AsyncSession, uid: str) -> UserPublic:
    """Tek user — LDAP + DB metadata birleşik."""
    ldap_client = get_ldap()
    entry = ldap_client.search_user_by_uid(uid)
    if entry is None:
        raise NotFoundError(f"'{uid}' bulunamadı", code="USER_NOT_FOUND")

    stmt = select(UserMetadata).where(UserMetadata.ldap_uid == uid)
    result = await db.execute(stmt)
    metadata = result.scalar_one_or_none()

    return _ldap_entry_to_public(entry["dn"], entry["attributes"], metadata)


async def list_users(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    search: str | None = None,
) -> dict[str, Any]:
    """
    Paginated user listesi.

    Sayfalama LDAP search'inden geliyor; LDAP'in paging extension'ı yerine
    ldap3 üzerinden tüm sonuçları çekip Python'da kesiyoruz. Büyük dizinler
    için bu yetersiz olabilir; ileri optimizasyon ileri tura.
    """
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 500:
        page_size = 50

    settings = get_settings()
    ldap_client = get_ldap()

    base_dn = _people_ou()
    if search:
        s = search.strip().replace("*", "").lower()
        # uid, cn, mail içinde substring ara
        filter_str = f"(&(objectClass=inetOrgPerson)(|(uid=*{s}*)(cn=*{s}*)(mail=*{s}*)))"
    else:
        filter_str = "(objectClass=inetOrgPerson)"

    attrs = [
        "uid", "cn", "sn", "givenName", "displayName", "mail",
        "telephoneNumber", "title", "departmentNumber", "ou",
        "mtlPreferredLanguage", "mtlMfaEnabled", "mtlSecurityFlags",
    ]

    try:
        results = ldap_client.search(
            base=base_dn,
            filter=filter_str,
            attributes=attrs,
        )
    except LDAPError as e:
        raise ValidationError(f"LDAP search hatası: {e}", code="LDAP_SEARCH_FAILED") from e

    total = len(results)
    start = (page - 1) * page_size
    end = start + page_size
    page_results = results[start:end]

    # Metadata batch fetch
    uids = [r["attributes"].get("uid", [""])[0] for r in page_results if r["attributes"].get("uid")]
    metadata_map: dict[str, UserMetadata] = {}
    if uids:
        meta_stmt = select(UserMetadata).where(UserMetadata.ldap_uid.in_(uids))
        meta_result = await db.execute(meta_stmt)
        metadata_map = {m.ldap_uid: m for m in meta_result.scalars()}

    items = [
        _ldap_entry_to_public(
            r["dn"],
            r["attributes"],
            metadata_map.get((r["attributes"].get("uid") or [""])[0]),
        )
        for r in page_results
    ]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }


# ============================================================================
# Update
# ============================================================================


async def update_user(
    db: AsyncSession,
    uid: str,
    payload: UserUpdateRequest,
    updated_by: UUID | None = None,
) -> UserPublic:
    """User attribute'larını güncelle (LDAP MODIFY_REPLACE)."""
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    ldap_client = get_ldap()
    entry = ldap_client.search_user_by_uid(uid)
    if entry is None:
        raise NotFoundError(f"'{uid}' bulunamadı", code="USER_NOT_FOUND")

    dn = entry["dn"]

    # LDAP attribute eşleştirmesi
    ldap_changes: dict[str, list[tuple[str, list[str]]]] = {}
    if payload.cn is not None:
        ldap_changes["cn"] = [(MODIFY_REPLACE, [payload.cn])]
    if payload.sn is not None:
        ldap_changes["sn"] = [(MODIFY_REPLACE, [payload.sn])]
    if payload.given_name is not None:
        ldap_changes["givenName"] = [(MODIFY_REPLACE, [payload.given_name])]
    if payload.display_name is not None:
        ldap_changes["displayName"] = [(MODIFY_REPLACE, [payload.display_name])]
    if payload.email is not None:
        ldap_changes["mail"] = [(MODIFY_REPLACE, [payload.email] if payload.email else [])]
    if payload.phone is not None:
        ldap_changes["telephoneNumber"] = [(MODIFY_REPLACE, [payload.phone] if payload.phone else [])]
    if payload.title is not None:
        ldap_changes["title"] = [(MODIFY_REPLACE, [payload.title] if payload.title else [])]
    if payload.department is not None:
        ldap_changes["departmentNumber"] = [(MODIFY_REPLACE, [payload.department] if payload.department else [])]
    if payload.preferred_language is not None:
        ldap_changes["mtlPreferredLanguage"] = [(MODIFY_REPLACE, [payload.preferred_language])]
    if payload.is_active is not None:
        flag = "ACTIVE" if payload.is_active else "INACTIVE"
        ldap_changes["mtlSecurityFlags"] = [(MODIFY_REPLACE, [flag])]

    if ldap_changes:
        with ldap_client.write() as conn:
            ok = conn.modify(dn, ldap_changes)
            if not ok:
                err = conn.result
                raise ValidationError(
                    f"LDAP modify başarısız: {err.get('description')}",
                    code="LDAP_MODIFY_FAILED",
                    details={"ldap_result": err},
                )

    # DB metadata
    stmt = select(UserMetadata).where(UserMetadata.ldap_uid == uid)
    result = await db.execute(stmt)
    metadata = result.scalar_one_or_none()
    if metadata is None:
        # Yoksa oluştur (orphan_ldap durumunu otomatik düzelt)
        metadata = UserMetadata(
            ldap_uid=uid,
            ldap_dn=dn,
            is_active=payload.is_active if payload.is_active is not None else True,
            email=payload.email,
            display_name=payload.display_name,
            ldap_sync_status="in_sync",
            ldap_last_synced_at=datetime.now(timezone.utc),
        )
        db.add(metadata)
    else:
        if payload.email is not None:
            metadata.email = payload.email
        if payload.display_name is not None:
            metadata.display_name = payload.display_name
        if payload.is_active is not None:
            metadata.is_active = payload.is_active
        if payload.security_flags is not None:
            metadata.security_flags = {**metadata.security_flags, **payload.security_flags}
        metadata.updated_by = updated_by
        metadata.ldap_last_synced_at = datetime.now(timezone.utc)
        metadata.ldap_sync_status = "in_sync"

    await db.flush()

    # Tekrar oku ve dön
    return await get_user(db, uid)


# ============================================================================
# Delete
# ============================================================================


async def delete_user(
    db: AsyncSession,
    uid: str,
    deleted_by: UUID | None = None,
) -> None:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    ldap_client = get_ldap()
    entry = ldap_client.search_user_by_uid(uid)
    if entry is None:
        raise NotFoundError(f"'{uid}' bulunamadı", code="USER_NOT_FOUND")

    dn = entry["dn"]

    with ldap_client.write() as conn:
        ok = conn.delete(dn)
        if not ok:
            err = conn.result
            raise ValidationError(
                f"LDAP delete başarısız: {err.get('description')}",
                code="LDAP_DELETE_FAILED",
                details={"ldap_result": err},
            )

    # DB metadata sil
    stmt = select(UserMetadata).where(UserMetadata.ldap_uid == uid)
    result = await db.execute(stmt)
    metadata = result.scalar_one_or_none()
    if metadata is not None:
        await db.delete(metadata)
        await db.flush()

    logger.info("ldap.user.deleted", uid=uid, dn=dn, deleted_by=str(deleted_by) if deleted_by else None)


# ============================================================================
# Password reset (admin tarafından)
# ============================================================================


async def reset_user_password(
    db: AsyncSession,
    uid: str,
    new_password: str,
    must_change: bool = True,
    reset_by: UUID | None = None,
) -> None:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    ldap_client = get_ldap()
    entry = ldap_client.search_user_by_uid(uid)
    if entry is None:
        raise NotFoundError(f"'{uid}' bulunamadı", code="USER_NOT_FOUND")

    dn = entry["dn"]
    hashed = _hash_password_for_ldap(new_password)

    with ldap_client.write() as conn:
        ok = conn.modify(dn, {"userPassword": [(MODIFY_REPLACE, [hashed])]})
        if not ok:
            raise ValidationError(
                f"Parola güncelleme başarısız: {conn.result.get('description')}",
                code="LDAP_MODIFY_FAILED",
            )
        # must_change -> LDAP pwdReset (syncrepl ile slave'e replike olur; ppolicy
        # kullanici kendi parolasini degistirince otomatik temizler). Best-effort.
        try:
            _reset_val = ["TRUE"] if must_change else []
            conn.modify(dn, {"pwdReset": [(MODIFY_REPLACE, _reset_val)]})
        except Exception as _e:  # noqa: BLE001
            logger.warning("ldap.user.pwdreset_set_failed", uid=uid, error=str(_e))

        # 3. parti uygulama kilidi (POSIX shadow): must_change ise hesabi expired
        # yap -> NAS/pam reddeder ve kullanici MTL'ye girip degistirmek zorunda kalir.
        if must_change:
            _set_shadow_lock(conn, dn, uid)
        else:
            _clear_shadow_lock(conn, dn, uid)

    # DB metadata
    stmt = select(UserMetadata).where(UserMetadata.ldap_uid == uid)
    result = await db.execute(stmt)
    metadata = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if metadata is not None:
        metadata.password_changed_at = now
        metadata.must_change_password = must_change
        metadata.failed_login_count = 0
        metadata.is_locked = False
        metadata.locked_until = None
        metadata.updated_by = reset_by
        await db.flush()

    logger.info("ldap.user.password_reset", uid=uid, reset_by=str(reset_by) if reset_by else None)


async def change_own_password(
    ldap_dn: str,
    current_password: str,
    new_password: str,
) -> bool:
    """
    Kullanıcının kendi parolasını değiştirmesi.

    1. Mevcut parola ile bind dene
    2. Başarılıysa MODIFY_REPLACE ile yeni parola yaz
    """
    ldap_client = get_ldap()

    # Bind kontrolü
    if not ldap_client.bind_as(ldap_dn, current_password):
        return False

    hashed = _hash_password_for_ldap(new_password)
    with ldap_client.write() as conn:
        ok = conn.modify(ldap_dn, {"userPassword": [(MODIFY_REPLACE, [hashed])]})
        if ok:
            # parola degisti -> 3. parti kilidini ac + pwdReset temizle
            _clear_shadow_lock(conn, ldap_dn, ldap_dn)
        return bool(ok)


# ============================================================================
# Lock / Unlock / Activate / Deactivate
# ============================================================================


async def set_user_lock(
    db: AsyncSession,
    uid: str,
    locked: bool,
    actor: UUID | None = None,
) -> None:
    """DB metadata üzerinden lockout — LDAP'e direkt yansımaz."""
    stmt = select(UserMetadata).where(UserMetadata.ldap_uid == uid)
    result = await db.execute(stmt)
    metadata = result.scalar_one_or_none()
    if metadata is None:
        # LDAP'te var mı önce kontrol
        if get_ldap().search_user_by_uid(uid) is None:
            raise NotFoundError(f"'{uid}' bulunamadı", code="USER_NOT_FOUND")
        metadata = UserMetadata(
            ldap_uid=uid,
            ldap_dn=_user_dn(uid),
            is_locked=locked,
            ldap_sync_status="in_sync",
        )
        db.add(metadata)
    else:
        metadata.is_locked = locked
        if not locked:
            metadata.locked_until = None
            metadata.failed_login_count = 0
        metadata.updated_by = actor
    await db.flush()
    logger.info("ldap.user.lock_changed", uid=uid, locked=locked, actor=str(actor) if actor else None)


async def set_user_active(
    db: AsyncSession,
    uid: str,
    active: bool,
    actor: UUID | None = None,
) -> None:
    """is_active hem LDAP mtlSecurityFlags hem DB metadata."""
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    ldap_client = get_ldap()
    entry = ldap_client.search_user_by_uid(uid)
    if entry is None:
        raise NotFoundError(f"'{uid}' bulunamadı", code="USER_NOT_FOUND")

    dn = entry["dn"]
    flag = "ACTIVE" if active else "INACTIVE"

    with ldap_client.write() as conn:
        conn.modify(dn, {"mtlSecurityFlags": [(MODIFY_REPLACE, [flag])]})

    stmt = select(UserMetadata).where(UserMetadata.ldap_uid == uid)
    result = await db.execute(stmt)
    metadata = result.scalar_one_or_none()
    if metadata is not None:
        metadata.is_active = active
        metadata.updated_by = actor
        await db.flush()

    logger.info("ldap.user.active_changed", uid=uid, active=active, actor=str(actor) if actor else None)


# ============================================================================
# MFA reset (admin tarafından)
# ============================================================================


async def admin_reset_mfa_for_user(
    db: AsyncSession,
    uid: str,
    actor: UUID | None = None,
) -> None:
    """End-user'ın MFA'sını sıfırla: LDAP'te mtlMfaSecret sil, flag FALSE."""
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    ldap_client = get_ldap()
    entry = ldap_client.search_user_by_uid(uid)
    if entry is None:
        raise NotFoundError(f"'{uid}' bulunamadı", code="USER_NOT_FOUND")

    dn = entry["dn"]
    with ldap_client.write() as conn:
        conn.modify(
            dn,
            {
                "mtlMfaSecret": [(MODIFY_REPLACE, [])],
                "mtlMfaEnabled": [(MODIFY_REPLACE, ["FALSE"])],
            },
        )

    stmt = select(UserMetadata).where(UserMetadata.ldap_uid == uid)
    result = await db.execute(stmt)
    metadata = result.scalar_one_or_none()
    if metadata is not None:
        metadata.mfa_enabled = False
        metadata.mfa_enrolled_at = None
        metadata.mfa_last_used_at = None
        metadata.updated_by = actor
        await db.flush()

    logger.info("ldap.user.mfa_reset", uid=uid, actor=str(actor) if actor else None)

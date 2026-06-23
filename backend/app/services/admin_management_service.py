# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Admin yönetimi (DB-resident admin'ler için CRUD).

Admin'ler:
  - mtl_core.admin_account tablosunda
  - İsteğe bağlı: ou=admins,dc=mtl,dc=local altında LDAP entry de var
  - Rolleri admin_role tablosundan
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from ldap3 import MODIFY_REPLACE
from passlib.hash import ldap_salted_sha1
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.ldap import LDAPError, get_ldap
from app.core.logging import get_logger
from app.core.security import hash_password
from app.models.admin import AdminAccount, AdminRole
from app.models.rbac import Role, RolePermission
from app.schemas.admins import AdminCreateRequest, AdminPublicFull, AdminUpdateRequest
from app.services.admin_service import get_admin_permissions, get_admin_roles

logger = get_logger(__name__)


def _admins_ou() -> str:
    return f"ou=admins,{get_settings().ldap_base_dn}"


def _admin_ldap_dn(username: str) -> str:
    return f"uid={username},{_admins_ou()}"


# ============================================================================
# Create
# ============================================================================


async def create_admin(
    db: AsyncSession,
    payload: AdminCreateRequest,
    created_by: UUID | None = None,
) -> AdminPublicFull:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    # Username/email çakışması
    stmt = select(AdminAccount).where(
        (AdminAccount.username == payload.username) | (AdminAccount.email == payload.email)
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    if existing is not None:
        raise ConflictError(
            f"username veya email zaten kullanılıyor",
            code="ADMIN_EXISTS",
            details={"username": payload.username, "email": payload.email},
        )
    # Parola politikası (Settings-driven) — yalnizca konsol parolasi olan admin'ler.
    # link_existing_uid varsa admin LDAP parolasiyla girer, konsol parolasi yoktur.
    if not payload.link_existing_uid:
        from app.services.password_policy_service import validate_password_async
        await validate_password_async(db, payload.password, username=payload.username)

    # Tur 10.2 — Var olan LDAP user'dan admin oluşturma
    if payload.link_existing_uid:
        ldap_client = get_ldap()
        people_base = _admins_ou().replace("ou=admins", "ou=people")
        try:
            results = ldap_client.search(
                base=people_base,
                filter=f"(uid={payload.link_existing_uid})",
                attributes=["uid", "cn", "displayName", "mail"],
            )
        except LDAPError as e:
            raise ValidationError(
                f"LDAP user araması başarısız: {e}",
                code="LDAP_SEARCH_FAILED",
            )
        if not results:
            raise ValidationError(
                f"LDAP kullanıcısı bulunamadı: uid={payload.link_existing_uid}",
                code="LDAP_USER_NOT_FOUND",
            )
        # DN'i al, create_in_ldap'i zorla False yap
        ldap_dn = results[0].get("dn") or results[0].get("entry_dn")
        if not ldap_dn:
            # Bazı ldap3 versiyonları DN'i farklı key'de döner
            ldap_dn = f"uid={payload.link_existing_uid},{people_base}"
        # LDAP'te zaten var — yeni entry oluşturma
        # create_in_ldap_effective sadece bu fonksiyon scope'unda — payload'a dokunma
        create_in_ldap_effective = False
    else:
        ldap_dn = _admin_ldap_dn(payload.username) if payload.create_in_ldap else None
        create_in_ldap_effective = payload.create_in_ldap

    # LDAP entry oluştur (opsiyonel)
    if create_in_ldap_effective:
        ldap_client = get_ldap()
        # Önce ou=admins var mı kontrol et, yoksa oluştur
        try:
            ou_results = ldap_client.search(
                base=_admins_ou(),
                filter="(objectClass=*)",
                attributes=["ou"],
                scope="BASE",
            )
            ou_exists = bool(ou_results)
        except LDAPError:
            ou_exists = False

        if not ou_exists:
            with ldap_client.write() as conn:
                conn.add(
                    _admins_ou(),
                    ["organizationalUnit"],
                    {"ou": "admins"},
                )

        # Admin entry'sini oluştur
        attrs: dict[str, Any] = {
            "uid": payload.username,
            "cn": payload.display_name,
            "sn": payload.display_name.split()[-1] if " " in payload.display_name else payload.display_name,
            "displayName": payload.display_name,
            "mail": payload.email,
            "userPassword": ldap_salted_sha1.hash(payload.password),
            "mtlMfaEnabled": "FALSE",
            "mtlPreferredLanguage": "tr",
            "mtlSecurityFlags": "ADMIN",
        }
        with ldap_client.write() as conn:
            ok = conn.add(ldap_dn, ["inetOrgPerson", "mtlPersonExtension"], attrs)
            if not ok:
                err_code = conn.result.get("result")
                if err_code != 68:  # entryAlreadyExists OK say
                    raise ValidationError(
                        f"LDAP admin entry oluşturulamadı: {conn.result.get('description')}",
                        code="LDAP_ADD_FAILED",
                        details={"ldap_result": conn.result},
                    )

    # DB admin kaydı
    now = datetime.now(timezone.utc)
    if payload.link_existing_uid:
        # LDAP-auth admin: konsol parolasi yok; ldap_dn'e simple-bind ile dogrulanir.
        # password_hash rastgele/kullanilamaz (asla verify edilmez), auth_source=ldap.
        import secrets
        _pw_hash = hash_password(secrets.token_urlsafe(32))
        _sec_flags: dict[str, Any] = {"auth_source": "ldap"}
        _must_change = False
    else:
        _pw_hash = hash_password(payload.password)
        # LDAP'ta da entry yaratildiysa (create_in_ldap) admin tek-kaynak LDAP olsun:
        # login ldap_dn'e simple-bind eder, self-service/telefon reset otomatik gecerli.
        # Saf DB-only admin (ldap_dn yok) ise DB hash ile login kalir.
        _sec_flags = {"auth_source": "ldap"} if ldap_dn else {}
        _must_change = payload.must_change_password
    admin = AdminAccount(
        username=payload.username,
        display_name=payload.display_name,
        email=payload.email,
        password_hash=_pw_hash,
        is_active=True,
        ldap_dn=ldap_dn,
        must_change_password=_must_change,
        password_changed_at=now,
        security_flags=_sec_flags,
    )
    db.add(admin)
    await db.flush()

    # Rolleri ata
    if payload.role_names:
        for role_name in payload.role_names:
            role_stmt = select(Role).where(Role.name == role_name)
            r = await db.execute(role_stmt)
            role = r.scalar_one_or_none()
            if role is None:
                logger.warning("admin.create.role_not_found", role_name=role_name)
                continue
            db.add(AdminRole(admin_id=admin.id, role_id=role.id))

    await db.flush()
    await db.refresh(admin, attribute_names=["role_assignments"])

    logger.info(
        "admin.created",
        username=payload.username,
        admin_id=str(admin.id),
        ldap_dn=ldap_dn,
        roles=payload.role_names,
        created_by=str(created_by) if created_by else None,
    )

    return await _admin_to_public(db, admin)


# ============================================================================
# Read
# ============================================================================


async def get_admin(db: AsyncSession, admin_id: UUID) -> AdminPublicFull:
    stmt = (
        select(AdminAccount)
        .options(
            selectinload(AdminAccount.role_assignments)
            .selectinload(AdminRole.role)
            .selectinload(Role.permission_assignments)
            .selectinload(RolePermission.permission)
        )
        .where(AdminAccount.id == admin_id)
    )
    result = await db.execute(stmt)
    admin = result.scalar_one_or_none()
    if admin is None:
        raise NotFoundError(f"Admin bulunamadı: {admin_id}", code="ADMIN_NOT_FOUND")
    return await _admin_to_public(db, admin)


async def list_admins(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    search: str | None = None,
    is_active: bool | None = None,
) -> dict[str, Any]:
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 500:
        page_size = 50

    count_stmt = select(func.count()).select_from(AdminAccount)
    base_stmt = (
        select(AdminAccount)
        .options(
            selectinload(AdminAccount.role_assignments)
            .selectinload(AdminRole.role)
            .selectinload(Role.permission_assignments)
            .selectinload(RolePermission.permission)
        )
    )

    if search:
        s = f"%{search.lower()}%"
        from sqlalchemy import or_
        base_stmt = base_stmt.where(
            or_(
                func.lower(AdminAccount.username).like(s),
                func.lower(AdminAccount.email).like(s),
                func.lower(AdminAccount.display_name).like(s),
            )
        )
        count_stmt = select(func.count()).select_from(AdminAccount).where(
            or_(
                func.lower(AdminAccount.username).like(s),
                func.lower(AdminAccount.email).like(s),
                func.lower(AdminAccount.display_name).like(s),
            )
        )

    if is_active is not None:
        base_stmt = base_stmt.where(AdminAccount.is_active == is_active)
        count_stmt = count_stmt.where(AdminAccount.is_active == is_active)

    total = (await db.execute(count_stmt)).scalar_one()
    base_stmt = base_stmt.order_by(AdminAccount.username).limit(page_size).offset((page - 1) * page_size)
    rows = await db.execute(base_stmt)
    admins = rows.scalars().all()

    items = [await _admin_to_public(db, a) for a in admins]
    return {"total": total, "page": page, "page_size": page_size, "items": items}


# ============================================================================
# Update / Delete
# ============================================================================


async def update_admin(
    db: AsyncSession,
    admin_id: UUID,
    payload: AdminUpdateRequest,
    updated_by: UUID | None = None,
) -> AdminPublicFull:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    stmt = select(AdminAccount).where(AdminAccount.id == admin_id)
    result = await db.execute(stmt)
    admin = result.scalar_one_or_none()
    if admin is None:
        raise NotFoundError("Admin bulunamadı", code="ADMIN_NOT_FOUND")

    if payload.display_name is not None:
        admin.display_name = payload.display_name
    if payload.email is not None:
        admin.email = payload.email
    if payload.is_active is not None:
        admin.is_active = payload.is_active
    if payload.must_change_password is not None:
        admin.must_change_password = payload.must_change_password
    if payload.security_flags is not None:
        admin.security_flags = {**(admin.security_flags or {}), **payload.security_flags}

    await db.flush()

    # LDAP entry varsa onu da güncelle
    if admin.ldap_dn:
        ldap_client = get_ldap()
        changes = {}
        if payload.display_name is not None:
            changes["displayName"] = [(MODIFY_REPLACE, [payload.display_name])]
            changes["cn"] = [(MODIFY_REPLACE, [payload.display_name])]
        if payload.email is not None:
            changes["mail"] = [(MODIFY_REPLACE, [payload.email])]
        if payload.is_active is not None:
            changes["mtlSecurityFlags"] = [(MODIFY_REPLACE, ["ADMIN" if payload.is_active else "ADMIN-INACTIVE"])]

        if changes:
            try:
                with ldap_client.write() as conn:
                    conn.modify(admin.ldap_dn, changes)
            except LDAPError as e:
                logger.warning("admin.update.ldap_failed", admin_id=str(admin.id), error=str(e))

    logger.info("admin.updated", admin_id=str(admin.id), by=str(updated_by) if updated_by else None)
    return await get_admin(db, admin.id)


async def delete_admin(
    db: AsyncSession,
    admin_id: UUID,
    deleted_by: UUID | None = None,
) -> None:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    stmt = select(AdminAccount).where(AdminAccount.id == admin_id)
    result = await db.execute(stmt)
    admin = result.scalar_one_or_none()
    if admin is None:
        raise NotFoundError("Admin bulunamadı", code="ADMIN_NOT_FOUND")

    if admin.username == "happy":
        raise ValidationError(
            "Bootstrap admin (happy) silinemez. Önce başka super_admin yaratıp happy'yi devre dışı bırakın.",
            code="BOOTSTRAP_PROTECTED",
        )

    # LDAP entry varsa sil
    if admin.ldap_dn:
        ldap_client = get_ldap()
        try:
            with ldap_client.write() as conn:
                conn.delete(admin.ldap_dn)
        except LDAPError as e:
            logger.warning("admin.delete.ldap_failed", admin_id=str(admin.id), error=str(e))

    await db.delete(admin)
    await db.flush()
    logger.info("admin.deleted", admin_id=str(admin_id), by=str(deleted_by) if deleted_by else None)


# ============================================================================
# Rol yönetimi
# ============================================================================


async def assign_role_to_admin(
    db: AsyncSession,
    admin_id: UUID,
    role_name: str,
    granted_by: UUID | None = None,
) -> None:
    a_stmt = select(AdminAccount).where(AdminAccount.id == admin_id)
    a_result = await db.execute(a_stmt)
    admin = a_result.scalar_one_or_none()
    if admin is None:
        raise NotFoundError("Admin bulunamadı", code="ADMIN_NOT_FOUND")

    r_stmt = select(Role).where(Role.name == role_name)
    r_result = await db.execute(r_stmt)
    role = r_result.scalar_one_or_none()
    if role is None:
        raise NotFoundError(f"'{role_name}' rolü bulunamadı", code="ROLE_NOT_FOUND")

    # Var mı kontrolü
    existing_stmt = select(AdminRole).where(
        AdminRole.admin_id == admin.id,
        AdminRole.role_id == role.id,
    )
    if (await db.execute(existing_stmt)).scalar_one_or_none() is not None:
        return  # Idempotent

    db.add(AdminRole(admin_id=admin.id, role_id=role.id))
    await db.flush()
    logger.info(
        "admin.role_assigned",
        admin_id=str(admin.id),
        role=role_name,
        by=str(granted_by) if granted_by else None,
    )


async def revoke_role_from_admin(
    db: AsyncSession,
    admin_id: UUID,
    role_id: UUID,
    revoked_by: UUID | None = None,
) -> None:
    stmt = select(AdminRole).where(
        AdminRole.admin_id == admin_id,
        AdminRole.role_id == role_id,
    )
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()
    if assignment is None:
        return  # Yoksa idempotent
    await db.delete(assignment)
    await db.flush()
    logger.info(
        "admin.role_revoked",
        admin_id=str(admin_id),
        role_id=str(role_id),
        by=str(revoked_by) if revoked_by else None,
    )


async def admin_reset_mfa(
    db: AsyncSession,
    admin_id: UUID,
    actor: UUID | None = None,
) -> None:
    """Başka bir admin'in MFA'sını sıfırla."""
    stmt = select(AdminAccount).where(AdminAccount.id == admin_id)
    result = await db.execute(stmt)
    admin = result.scalar_one_or_none()
    if admin is None:
        raise NotFoundError("Admin bulunamadı", code="ADMIN_NOT_FOUND")

    admin.mfa_enabled = False
    admin.mfa_secret_encrypted = None
    await db.flush()
    logger.info(
        "admin.mfa_reset_by_admin",
        admin_id=str(admin_id),
        by=str(actor) if actor else None,
    )


async def admin_reset_password(
    db: AsyncSession,
    admin_id: UUID,
    new_password: str,
    must_change: bool,
    actor: UUID | None = None,
) -> None:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    stmt = select(AdminAccount).where(AdminAccount.id == admin_id)
    result = await db.execute(stmt)
    admin = result.scalar_one_or_none()
    if admin is None:
        raise NotFoundError("Admin bulunamadı", code="ADMIN_NOT_FOUND")

    # Parola politikası (Settings-driven)
    from app.services.password_policy_service import validate_password_async
    await validate_password_async(db, new_password, username=admin.username)

    admin.password_hash = hash_password(new_password)
    admin.password_changed_at = datetime.now(timezone.utc)
    admin.must_change_password = must_change
    admin.failed_login_count = 0
    admin.locked_until = None
    await db.flush()

    # LDAP entry varsa orada da güncelle
    if admin.ldap_dn:
        ldap_client = get_ldap()
        try:
            hashed = ldap_salted_sha1.hash(new_password)
            with ldap_client.write() as conn:
                conn.modify(admin.ldap_dn, {"userPassword": [(MODIFY_REPLACE, [hashed])]})
        except LDAPError as e:
            logger.warning("admin.password_reset.ldap_failed", admin_id=str(admin_id), error=str(e))

    logger.info("admin.password_reset", admin_id=str(admin_id), by=str(actor) if actor else None)


# ============================================================================
# Helpers
# ============================================================================


async def _admin_to_public(db: AsyncSession, admin: AdminAccount) -> AdminPublicFull:
    """AdminAccount → AdminPublicFull."""
    roles = get_admin_roles(admin)
    perms = sorted(get_admin_permissions(admin))
    return AdminPublicFull(
        id=admin.id,
        username=admin.username,
        display_name=admin.display_name,
        email=admin.email,
        is_active=admin.is_active,
        mfa_enabled=admin.mfa_enabled,
        ldap_dn=admin.ldap_dn,
        must_change_password=admin.must_change_password,
        password_changed_at=admin.password_changed_at,
        last_login_at=admin.last_login_at,
        failed_login_count=admin.failed_login_count or 0,
        locked_until=admin.locked_until,
        security_flags=admin.security_flags or {},
        created_at=admin.created_at,
        updated_at=admin.updated_at,
        roles=[r.name for r in roles],
        permissions=perms,
    )



# ============================================================================
# Tur 10.2 — Var olan LDAP user listesi
# ============================================================================
async def list_available_ldap_users(
    db: AsyncSession,
    *,
    search: str | None = None,
    limit: int = 200,
) -> dict:
    """ou=people altındaki LDAP user'larını döner (zaten admin olanlar hariç).

    Returns:
        {"items": [{uid, display_name, email, dn}, ...], "total": N}
    """
    from app.models.admin import AdminAccount

    ldap_client = get_ldap()
    people_base = _admins_ou().replace("ou=admins", "ou=people")

    # LDAP filter
    if search:
        search_safe = search.replace("(", "").replace(")", "").replace("*", "")
        ldap_filter = (
            f"(&(objectClass=inetOrgPerson)"
            f"(|(uid=*{search_safe}*)(cn=*{search_safe}*)(mail=*{search_safe}*)))"
        )
    else:
        ldap_filter = "(objectClass=inetOrgPerson)"

    try:
        results = ldap_client.search(
            base=people_base,
            filter=ldap_filter,
            attributes=["uid", "cn", "displayName", "mail"],
        )
    except LDAPError as e:
        raise ValidationError(
            f"LDAP user listesi başarısız: {e}",
            code="LDAP_SEARCH_FAILED",
        )

    # Zaten admin olan uid'leri çıkar (linked olabilir, sıfırdan eklenemez)
    admin_uids_stmt = select(AdminAccount.username)
    admin_uids = set((await db.execute(admin_uids_stmt)).scalars().all())

    items = []
    for entry in results[:limit]:
        attrs = entry.get("attributes") or entry
        uid_raw = attrs.get("uid")
        if isinstance(uid_raw, list):
            uid = uid_raw[0] if uid_raw else None
        else:
            uid = uid_raw
        if not uid or uid in admin_uids:
            continue

        def _first(v):
            if isinstance(v, list):
                return v[0] if v else None
            return v

        display = _first(attrs.get("displayName")) or _first(attrs.get("cn"))
        email = _first(attrs.get("mail"))
        dn = entry.get("dn") or entry.get("entry_dn") or f"uid={uid},{people_base}"

        items.append({
            "uid": str(uid),
            "display_name": str(display) if display else None,
            "email": str(email) if email else None,
            "dn": str(dn),
        })

    items.sort(key=lambda x: x["uid"].lower())
    return {"items": items, "total": len(items)}

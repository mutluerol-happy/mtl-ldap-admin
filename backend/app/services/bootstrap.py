# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
Bootstrap admin oluşturma.

Master sunucu ilk başlatıldığında:
  - Env'deki BOOTSTRAP_ADMIN_USERNAME (örn. happy) admin_account'ta yoksa oluştur
  - password_hash = bcrypt
  - super_admin rolünü ata (DB'deki mevcut adıyla)

Rol adı çözümlemesi:
  Tablo seed'i 'mtl.super_admin' veya 'super_admin' kullanabilir.
  İki adı da arayıp ilk bulunanı kullanırız. Hiçbiri yoksa hata değil — uyarı.

Idempotent: var olan hesap her seferinde bırakılır.
Slave'de no-op.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import hash_password
from app.models.admin import AdminAccount, AdminRole
from app.models.rbac import Role

logger = get_logger(__name__)

# Tabloda hangi isimle saklı olabilir? Sırayla ararız.
SUPER_ADMIN_ROLE_CANDIDATES: tuple[str, ...] = (
    "mtl.super_admin",   # Master kurulum SQL şemasındaki adı
    "super_admin",       # Eski / kısa ad (fallback)
)


async def ensure_bootstrap_admin(db: AsyncSession) -> None:
    """Master-only, idempotent."""
    settings = get_settings()
    if not settings.is_master:
        return

    username = (settings.bootstrap_admin_username or "").strip().lower()
    password_secret = settings.bootstrap_admin_password
    email = settings.bootstrap_admin_email

    if not username or not password_secret:
        logger.warning("bootstrap.skipped", reason="username/password env eksik")
        return

    # 1) Admin'i bul veya oluştur
    stmt = select(AdminAccount).where(AdminAccount.username == username)
    result = await db.execute(stmt)
    admin = result.scalar_one_or_none()

    if admin is None:
        admin = AdminAccount(
            username=username,
            display_name=f"{username.title()} (Bootstrap Admin)",
            email=email or f"{username}@mtl.local",
            password_hash=hash_password(password_secret.get_secret_value()),
            is_active=True,
            mfa_enabled=False,
        )
        db.add(admin)
        await db.flush()
        logger.info("bootstrap.admin_created", username=username, admin_id=str(admin.id))
    else:
        logger.info("bootstrap.admin_exists", username=username)

    # 2) super_admin rolünü bul (DB'deki adıyla)
    super_admin: Role | None = None
    for candidate_name in SUPER_ADMIN_ROLE_CANDIDATES:
        role_stmt = select(Role).where(Role.name == candidate_name)
        result = await db.execute(role_stmt)
        super_admin = result.scalar_one_or_none()
        if super_admin is not None:
            logger.info("bootstrap.role_found", role_name=candidate_name)
            break

    if super_admin is None:
        logger.error(
            "bootstrap.no_super_admin_role",
            tried=list(SUPER_ADMIN_ROLE_CANDIDATES),
            hint="mtl_core.role tablosunda super_admin benzeri bir rol bulunamadı. "
                 "SQL şemasını yükleyin veya manuel rol oluşturun.",
        )
        await db.commit()
        return

    # 3) Atama var mı?
    assign_stmt = select(AdminRole).where(
        AdminRole.admin_id == admin.id,
        AdminRole.role_id == super_admin.id,
    )
    result = await db.execute(assign_stmt)
    existing = result.scalar_one_or_none()

    if existing is None:
        db.add(AdminRole(admin_id=admin.id, role_id=super_admin.id))
        await db.flush()
        logger.info(
            "bootstrap.role_assigned",
            username=username,
            role=super_admin.name,
        )
    else:
        logger.info("bootstrap.role_already_assigned", username=username, role=super_admin.name)

    # 4) Bootstrap admin'i LDAP'e de yaz (Tur 3 — admin'ler iki yerde)
    try:
        await _ensure_bootstrap_admin_in_ldap(db, admin, password_secret.get_secret_value())
    except Exception as e:  # noqa: BLE001
        logger.warning("bootstrap.ldap_sync_failed", error=str(e),
                       hint="LDAP entry oluşturulamadı — başlatma yine de devam ediyor")

    await db.commit()


async def _ensure_bootstrap_admin_in_ldap(
    db: AsyncSession,
    admin: AdminAccount,
    plain_password: str,
) -> None:
    """Bootstrap admin'i ou=admins,dc=mtl,dc=local altında LDAP entry olarak yarat (idempotent)."""
    from ldap3 import MODIFY_REPLACE
    from passlib.hash import ldap_salted_sha1

    from app.core.config import get_settings
    from app.core.ldap import LDAPError, get_ldap

    settings = get_settings()
    admins_ou = f"ou=admins,{settings.ldap_base_dn}"
    admin_dn = f"uid={admin.username},{admins_ou}"

    ldap_client = get_ldap()

    # ou=admins var mı?
    try:
        ou_results = ldap_client.search(
            base=admins_ou,
            filter="(objectClass=*)",
            attributes=["ou"],
            scope="BASE",
        )
        ou_exists = bool(ou_results)
    except LDAPError:
        ou_exists = False

    if not ou_exists:
        try:
            with ldap_client.write() as conn:
                ok = conn.add(admins_ou, ["organizationalUnit"], {"ou": "admins"})
                if not ok and conn.result.get("result") != 68:
                    logger.warning("bootstrap.ldap_ou_create_failed", result=conn.result)
                else:
                    logger.info("bootstrap.ldap_ou_created", ou=admins_ou)
        except LDAPError as e:
            logger.warning("bootstrap.ldap_ou_error", error=str(e))
            return

    # Admin entry var mı?
    try:
        existing_entry = ldap_client.search(
            base=admin_dn,
            filter="(objectClass=*)",
            attributes=["uid"],
            scope="BASE",
        )
    except LDAPError:
        existing_entry = []

    if not existing_entry:
        # Yarat
        try:
            with ldap_client.write() as conn:
                attrs = {
                    "uid": admin.username,
                    "cn": admin.display_name,
                    "sn": admin.username.title(),
                    "displayName": admin.display_name,
                    "mail": admin.email,
                    "userPassword": ldap_salted_sha1.hash(plain_password),
                    "mtlMfaEnabled": "TRUE" if admin.mfa_enabled else "FALSE",
                    "mtlPreferredLanguage": "tr",
                    "mtlSecurityFlags": "ADMIN",
                }
                ok = conn.add(admin_dn, ["inetOrgPerson", "mtlPersonExtension"], attrs)
                if ok:
                    logger.info("bootstrap.ldap_admin_created", dn=admin_dn)
                elif conn.result.get("result") == 68:  # already exists
                    logger.info("bootstrap.ldap_admin_already_exists", dn=admin_dn)
                else:
                    logger.warning("bootstrap.ldap_admin_create_failed", result=conn.result)
        except LDAPError as e:
            logger.warning("bootstrap.ldap_admin_error", error=str(e))

    # DB'de ldap_dn alanı boşsa doldur
    if admin.ldap_dn != admin_dn:
        admin.ldap_dn = admin_dn
        await db.flush()
        logger.info("bootstrap.admin_ldap_dn_updated", dn=admin_dn)

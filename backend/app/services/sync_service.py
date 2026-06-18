# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
LDAP ↔ DB sync servisi.

Scan algoritması:
  1. LDAP'teki tüm end_user uid setini al
  2. DB user_metadata uid setini al
  3. Karşılaştır:
       - LDAP'te var DB'de yok → orphan_ldap
       - DB'de var LDAP'te yok → orphan_db
       - İkisinde de var ama email/displayname farklı → attribute_drift
       - mfa_enabled (DB) != mtlMfaEnabled (LDAP) → mfa_flag_drift
  4. Bulguları sync_discrepancy tablosuna yaz (yeni olanlar).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.ldap import get_ldap
from app.core.logging import get_logger
from app.models.sync_discrepancy import SyncDiscrepancy
from app.models.user_metadata import UserMetadata

logger = get_logger(__name__)


async def scan_user_sync(db: AsyncSession) -> dict[str, Any]:
    """
    Tüm LDAP ile DB metadata'yı karşılaştırıp tutarsızlıkları işle.

    Returns:
        Özet rapor.
    """
    settings = get_settings()
    ldap_client = get_ldap()
    base_dn = f"ou=people,{settings.ldap_base_dn}"

    # 1. LDAP user'ları
    ldap_entries = ldap_client.search(
        base=base_dn,
        filter="(objectClass=inetOrgPerson)",
        attributes=["uid", "mail", "displayName", "cn", "mtlMfaEnabled"],
    )
    ldap_users: dict[str, dict[str, Any]] = {}
    for e in ldap_entries:
        attrs = e["attributes"]
        uid_list = attrs.get("uid") or []
        if not uid_list:
            continue
        uid = str(uid_list[0])
        ldap_users[uid] = {
            "dn": e["dn"],
            "mail": (attrs.get("mail") or [None])[0],
            "displayName": (attrs.get("displayName") or attrs.get("cn") or [None])[0],
            "mtlMfaEnabled": str((attrs.get("mtlMfaEnabled") or ["FALSE"])[0]).upper() == "TRUE",
        }

    # 2. DB metadata
    stmt = select(UserMetadata)
    result = await db.execute(stmt)
    db_metas: dict[str, UserMetadata] = {m.ldap_uid: m for m in result.scalars()}

    # 3. Karşılaştırma
    ldap_uids = set(ldap_users.keys())
    db_uids = set(db_metas.keys())

    new_discrepancies: dict[tuple[str, str], SyncDiscrepancy] = {}
    in_sync_uids: set[str] = set()
    summary = {
        "orphan_ldap": 0,
        "orphan_db": 0,
        "attribute_drift": 0,
        "mfa_flag_drift": 0,
        "in_sync": 0,
    }

    # orphan_ldap (LDAP var, DB yok)
    for uid in ldap_uids - db_uids:
        new_discrepancies[("orphan_ldap", uid)] = SyncDiscrepancy(
            discrepancy_type="orphan_ldap",
            subject_type="END_USER",
            subject_id=uid,
            ldap_dn=ldap_users[uid]["dn"],
            diff_details={"ldap": ldap_users[uid]},
        )
        summary["orphan_ldap"] += 1

    # orphan_db (DB var, LDAP yok)
    for uid in db_uids - ldap_uids:
        meta = db_metas[uid]
        new_discrepancies[("orphan_db", uid)] = SyncDiscrepancy(
            discrepancy_type="orphan_db",
            subject_type="END_USER",
            subject_id=uid,
            ldap_dn=meta.ldap_dn,
            db_id=meta.id,
            diff_details={"db": {"email": meta.email, "display_name": meta.display_name}},
        )
        summary["orphan_db"] += 1

    # İki tarafta da olanlar — drift kontrolü
    common_uids = ldap_uids & db_uids
    for uid in common_uids:
        meta = db_metas[uid]
        ldap_data = ldap_users[uid]
        attribute_drifts = []
        if (ldap_data.get("mail") or None) != (meta.email or None):
            attribute_drifts.append({"field": "email", "ldap": ldap_data.get("mail"), "db": meta.email})
        if (ldap_data.get("displayName") or None) != (meta.display_name or None):
            attribute_drifts.append({"field": "display_name", "ldap": ldap_data.get("displayName"), "db": meta.display_name})

        if attribute_drifts:
            new_discrepancies[("attribute_drift", uid)] = SyncDiscrepancy(
                discrepancy_type="attribute_drift",
                subject_type="END_USER",
                subject_id=uid,
                ldap_dn=ldap_data["dn"],
                db_id=meta.id,
                diff_details={"drifts": attribute_drifts},
            )
            summary["attribute_drift"] += 1

        if ldap_data.get("mtlMfaEnabled") != meta.mfa_enabled:
            new_discrepancies[("mfa_flag_drift", uid)] = SyncDiscrepancy(
                discrepancy_type="mfa_flag_drift",
                subject_type="END_USER",
                subject_id=uid,
                ldap_dn=ldap_data["dn"],
                db_id=meta.id,
                diff_details={
                    "ldap_mfa_enabled": ldap_data.get("mtlMfaEnabled"),
                    "db_mfa_enabled": meta.mfa_enabled,
                },
            )
            summary["mfa_flag_drift"] += 1

        if not attribute_drifts and ldap_data.get("mtlMfaEnabled") == meta.mfa_enabled:
            in_sync_uids.add(uid)
            summary["in_sync"] += 1

    # 4. Mutabakat (idempotent): kopya uretme, biten sorunu auto-resolve, fazla kopyayi collapse
    existing_unresolved = (
        await db.execute(select(SyncDiscrepancy).where(SyncDiscrepancy.resolved_at.is_(None)))
    ).scalars().all()
    current_keys = set(new_discrepancies.keys())
    now = datetime.now(timezone.utc)
    seen: set[tuple[str, str]] = set()
    auto_resolved = 0
    superseded = 0
    for ex in existing_unresolved:
        key = (ex.discrepancy_type, ex.subject_id)
        if key in current_keys and key not in seen:
            seen.add(key)  # hala gecerli ilk kayit -> koru, guncel diff'i yansit
            ex.diff_details = new_discrepancies[key].diff_details
        elif key in current_keys:
            ex.resolved_at = now
            ex.resolution_action = "superseded"
            superseded += 1
        else:
            ex.resolved_at = now
            ex.resolution_action = "auto_resolved"
            auto_resolved += 1
    added = 0
    for key, disc in new_discrepancies.items():
        if key not in seen:
            db.add(disc)
            added += 1
    await db.flush()

    # 5. Sync edilen user_metadata'lar için ldap_last_synced_at güncelle
    if in_sync_uids:
        await db.execute(
            update(UserMetadata)
            .where(UserMetadata.ldap_uid.in_(in_sync_uids))
            .values(
                ldap_last_synced_at=datetime.now(timezone.utc),
                ldap_sync_status="in_sync",
            )
        )

    await db.commit()

    logger.info(
        "sync.scan_completed",
        total_ldap=len(ldap_uids),
        total_db=len(db_uids),
        new=added,
        auto_resolved=auto_resolved,
        superseded=superseded,
        **summary,
    )

    return {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "total_ldap_users": len(ldap_uids),
        "total_db_users": len(db_uids),
        "summary": summary,
        "new_discrepancies": added,
        "auto_resolved": auto_resolved,
        "superseded": superseded,
    }


async def get_sync_status(db: AsyncSession) -> dict[str, Any]:
    """Anlık özet — son tarama sonuçları + çözülmemiş tutarsızlıklar."""
    settings = get_settings()
    ldap_client = get_ldap()

    # LDAP toplam user
    try:
        ldap_entries = ldap_client.search(
            base=f"ou=people,{settings.ldap_base_dn}",
            filter="(objectClass=inetOrgPerson)",
            attributes=["uid"],
        )
        total_ldap = len(ldap_entries)
    except Exception:  # noqa: BLE001
        total_ldap = -1

    # DB toplam user
    from sqlalchemy import func as _func
    total_db = (await db.execute(select(_func.count()).select_from(UserMetadata))).scalar_one()

    # Çözülmemiş discrepancy
    unresolved_stmt = (
        select(SyncDiscrepancy)
        .where(SyncDiscrepancy.resolved_at.is_(None))
        .order_by(SyncDiscrepancy.discovered_at.desc())
    )
    unresolved = (await db.execute(unresolved_stmt)).scalars().all()

    # Tip dağılımı
    by_type: dict[str, int] = {}
    for d in unresolved:
        by_type[d.discrepancy_type] = by_type.get(d.discrepancy_type, 0) + 1

    # Son tarama zamanı (en yeni ldap_last_synced_at)
    last_scan_stmt = select(_func.max(UserMetadata.ldap_last_synced_at))
    last_scan = (await db.execute(last_scan_stmt)).scalar_one_or_none()

    return {
        "last_scan_at": last_scan,
        "total_ldap_users": total_ldap,
        "total_db_users": total_db,
        "in_sync_count": max(0, total_db - len(unresolved)),
        "discrepancy_count": len(unresolved),
        "by_type": by_type,
        "unresolved": unresolved,
    }


async def resolve_discrepancy(
    db: AsyncSession,
    discrepancy_id: UUID,
    action: str,
    resolver: UUID,
) -> None:
    """
    Tutarsızlığı çöz.

    Aksiyonlar:
      - create_ldap     : LDAP'e oluştur (orphan_db için)
      - create_db       : DB'ye oluştur (orphan_ldap için)
      - sync_attribute  : LDAP→DB veya DB→LDAP attribute kopyala
      - delete_db       : DB metadata'yı sil (orphan_db için)
      - delete_ldap     : LDAP entry'sini sil (orphan_ldap için)
      - ignore          : Hiçbir şey yapma, sadece resolved işaretle
    """
    stmt = select(SyncDiscrepancy).where(SyncDiscrepancy.id == discrepancy_id)
    result = await db.execute(stmt)
    d = result.scalar_one_or_none()
    if d is None:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Discrepancy bulunamadı", code="DISCREPANCY_NOT_FOUND")

    if d.resolved_at is not None:
        return  # Idempotent

    from app.core.exceptions import ValidationError as _ValidationError

    # Her tutarsızlık türü için yalnızca geçerli aksiyonlar (geçersizse sessizce
    # "resolved" işaretlemek yerine NET hata ver):
    _valid: dict[str, set[str]] = {
        "orphan_ldap": {"create_db", "delete_ldap", "ignore"},
        "orphan_db": {"delete_db", "ignore"},
        "attribute_drift": {"sync_attribute", "ignore"},
        "mfa_flag_drift": {"sync_attribute", "ignore"},
    }
    allowed = _valid.get(d.discrepancy_type, {"ignore"})
    if action not in allowed:
        raise _ValidationError(
            f"'{d.discrepancy_type}' icin gecersiz aksiyon: {action} "
            f"(gecerli: {', '.join(sorted(allowed))})",
            code="INVALID_RESOLUTION_ACTION",
        )

    if action == "delete_db":
        from sqlalchemy import delete as _delete
        await db.execute(_delete(UserMetadata).where(UserMetadata.id == d.db_id))

    elif action == "delete_ldap":
        ldap_client = get_ldap()
        if d.ldap_dn:
            try:
                with ldap_client.write() as conn:
                    conn.delete(d.ldap_dn)
            except Exception as e:  # noqa: BLE001
                logger.error("sync.delete_ldap_failed", dn=d.ldap_dn, error=str(e))
                raise

    elif action == "create_db":
        # orphan_ldap -> LDAP entry'sinden DB metadata (UserMetadata) olustur
        ldap_client = get_ldap()
        entry = ldap_client.search_user_by_uid(d.subject_id)
        if not entry:
            raise _ValidationError(
                "LDAP kaydi bulunamadi; create_db yapilamiyor", code="LDAP_ENTRY_MISSING"
            )
        attrs = entry["attributes"]
        existing = (
            await db.execute(
                select(UserMetadata).where(UserMetadata.ldap_uid == d.subject_id)
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                UserMetadata(
                    ldap_uid=d.subject_id,
                    ldap_dn=d.ldap_dn or entry["dn"],
                    email=(attrs.get("mail") or [None])[0],
                    display_name=(attrs.get("displayName") or attrs.get("cn") or [None])[0],
                    mfa_enabled=str((attrs.get("mtlMfaEnabled") or ["FALSE"])[0]).upper() == "TRUE",
                    ldap_sync_status="in_sync",
                    ldap_last_synced_at=datetime.now(timezone.utc),
                    created_by=resolver,
                    updated_by=resolver,
                )
            )

    elif action == "sync_attribute":
        # LDAP -> DB (LDAP source-of-truth): attribute_drift + mfa_flag_drift
        ldap_client = get_ldap()
        entry = ldap_client.search_user_by_uid(d.subject_id)
        if entry and d.db_id:
            attrs = entry["attributes"]
            meta = (
                await db.execute(select(UserMetadata).where(UserMetadata.id == d.db_id))
            ).scalar_one_or_none()
            if meta:
                meta.email = (attrs.get("mail") or [None])[0]
                meta.display_name = (attrs.get("displayName") or attrs.get("cn") or [None])[0]
                meta.mfa_enabled = str((attrs.get("mtlMfaEnabled") or ["FALSE"])[0]).upper() == "TRUE"
                meta.ldap_last_synced_at = datetime.now(timezone.utc)
                meta.ldap_sync_status = "in_sync"

    # action == "ignore" -> sadece resolved isaretle (asagida)

    d.resolved_at = datetime.now(timezone.utc)
    d.resolved_by = resolver
    d.resolution_action = action
    await db.flush()
    await db.commit()
    logger.info("sync.resolved", discrepancy_id=str(discrepancy_id), action=action, by=str(resolver))

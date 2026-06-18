# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""
LDAP group CRUD servisi.

  - ou=groups,dc=mtl,dc=local altında groupOfNames objectClass
  - member attribute: DN listesi
  - Üye ekleme/çıkarma: MODIFY_ADD / MODIFY_DELETE
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from ldap3 import MODIFY_ADD, MODIFY_DELETE, MODIFY_REPLACE

from app.core.config import get_settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.ldap import LDAPError, get_ldap
from app.core.logging import get_logger
from app.schemas.groups import GroupCreateRequest, GroupPublic

logger = get_logger(__name__)


def _groups_ou() -> str:
    return f"ou=groups,{get_settings().ldap_base_dn}"


def _group_dn(cn: str) -> str:
    return f"cn={cn},{_groups_ou()}"


def _user_dn_from_uid(uid: str) -> str:
    return f"uid={uid},ou=people,{get_settings().ldap_base_dn}"


def _next_gid_number(ldap_client: Any, base: int = 10000) -> int:
    """ou=groups icindeki en yuksek gidNumber + 1; yoksa base (posixGroup cakismasini onler)."""
    try:
        results = ldap_client.search(
            search_base=_groups_ou(),
            search_filter="(gidNumber=*)",
            attributes=["gidNumber"],
        )
    except LDAPError:
        results = []
    max_gid = base - 1
    for r in (results or []):
        for v in (r.get("attributes", {}).get("gidNumber") or []):
            try:
                n = int(str(v))
            except (TypeError, ValueError):
                continue
            if n > max_gid:
                max_gid = n
    return max_gid + 1


def _ldap_entry_to_public(entry_dn: str, attrs: dict[str, Any]) -> GroupPublic:
    def first(k: str) -> str | None:
        vals = attrs.get(k) or []
        return str(vals[0]) if vals else None

    members = [str(m) for m in (attrs.get("member") or attrs.get("memberUid") or [])]
    obj_classes = [str(o) for o in (attrs.get("objectClass") or [])]
    group_type = "groupOfNames" if "groupOfNames" in obj_classes else "posixGroup"

    return GroupPublic(
        cn=first("cn") or "",
        dn=entry_dn,
        description=first("description"),
        group_type=group_type,
        member_dns=members,
        member_count=len(members),
    )


# ============================================================================
# Create
# ============================================================================


async def create_group(payload: GroupCreateRequest, created_by: UUID | None = None) -> GroupPublic:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    dn = _group_dn(payload.cn)
    ldap_client = get_ldap()

    # Var mı kontrol
    existing = ldap_client.search(
        base=_groups_ou(),
        filter=f"(cn={payload.cn})",
        attributes=["cn"],
    )
    if existing:
        raise ConflictError(f"'{payload.cn}' adlı grup zaten var", code="GROUP_EXISTS")

    # Üye DN'leri (groupOfNames için "member" attribute zorunlu en az 1 üye)
    member_dns = [_user_dn_from_uid(uid) for uid in (payload.member_uids or [])]

    if payload.group_type == "groupOfNames":
        object_classes = ["groupOfNames"]
        # groupOfNames'in member attribute'u en az 1 değer ister.
        # Hiç üye yoksa placeholder olarak cn=admin'i ekleyemeyiz; ldap3 buna
        # özel destek için "" ile geçici çözüm yerine ou=people DN'ini kullanırız.
        if not member_dns:
            # En azından bir "boş" üye gerek — admin DN'i tipik placeholder.
            settings = get_settings()
            member_dns = [f"cn=admin,{settings.ldap_base_dn}"]
        attrs: dict[str, Any] = {
            "cn": payload.cn,
            "member": member_dns,
        }
    else:
        # posixGroup — memberUid uid listesi (DN değil)
        object_classes = ["posixGroup"]
        # gidNumber lazım. 10000'den başlayan range kullan
        attrs = {
            "cn": payload.cn,
            "gidNumber": str(_next_gid_number(ldap_client)),
        }
        # memberUid bossa attribute'u HIC ekleme (bos degerli attr -> protocolError)
        _member_uids = [uid for uid in (payload.member_uids or [])]
        if _member_uids:
            attrs["memberUid"] = _member_uids

    if payload.description:
        attrs["description"] = payload.description

    with ldap_client.write() as conn:
        ok = conn.add(dn, object_classes, attrs)
        if not ok:
            raise ValidationError(
                f"LDAP group add başarısız: {conn.result.get('description')}",
                code="LDAP_ADD_FAILED",
                details={"ldap_result": conn.result},
            )

    logger.info("ldap.group.created", cn=payload.cn, dn=dn, created_by=str(created_by) if created_by else None)

    # Geri oku
    try:
        result = ldap_client.search(
            base=dn,
            filter="(objectClass=*)",
            attributes=["cn", "description", "objectClass", "member", "memberUid"],
            scope="BASE",
        )
        if result:
            return _ldap_entry_to_public(result[0]["dn"], result[0]["attributes"])
    except LDAPError:
        pass

    # Fallback
    return GroupPublic(
        cn=payload.cn,
        dn=dn,
        description=payload.description,
        group_type=payload.group_type,
        member_dns=member_dns,
        member_count=len(member_dns),
    )


# ============================================================================
# Read
# ============================================================================


async def get_group(cn: str) -> GroupPublic:
    ldap_client = get_ldap()
    results = ldap_client.search(
        base=_groups_ou(),
        filter=f"(cn={cn})",
        attributes=["cn", "description", "objectClass", "member", "memberUid"],
    )
    if not results:
        raise NotFoundError(f"'{cn}' adlı grup yok", code="GROUP_NOT_FOUND")
    return _ldap_entry_to_public(results[0]["dn"], results[0]["attributes"])


async def list_groups(
    page: int = 1,
    page_size: int = 50,
    search: str | None = None,
) -> dict[str, Any]:
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 500:
        page_size = 50

    ldap_client = get_ldap()
    if search:
        s = search.strip().replace("*", "").lower()
        filter_str = f"(&(|(objectClass=groupOfNames)(objectClass=posixGroup))(|(cn=*{s}*)(description=*{s}*)))"
    else:
        filter_str = "(|(objectClass=groupOfNames)(objectClass=posixGroup))"

    results = ldap_client.search(
        base=_groups_ou(),
        filter=filter_str,
        attributes=["cn", "description", "objectClass", "member", "memberUid"],
    )
    total = len(results)
    start = (page - 1) * page_size
    end = start + page_size
    page_results = results[start:end]

    items = [_ldap_entry_to_public(r["dn"], r["attributes"]) for r in page_results]
    return {"total": total, "page": page, "page_size": page_size, "items": items}


# ============================================================================
# Update
# ============================================================================


async def update_group(cn: str, description: str | None) -> GroupPublic:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    ldap_client = get_ldap()
    grp = await get_group(cn)  # NotFoundError fırlatır
    dn = grp.dn

    if description is not None:
        with ldap_client.write() as conn:
            conn.modify(dn, {"description": [(MODIFY_REPLACE, [description] if description else [])]})

    return await get_group(cn)


# ============================================================================
# Delete
# ============================================================================


async def delete_group(cn: str, deleted_by: UUID | None = None) -> None:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    grp = await get_group(cn)
    ldap_client = get_ldap()
    with ldap_client.write() as conn:
        ok = conn.delete(grp.dn)
        if not ok:
            raise ValidationError(
                f"Group delete başarısız: {conn.result.get('description')}",
                code="LDAP_DELETE_FAILED",
            )
    logger.info("ldap.group.deleted", cn=cn, dn=grp.dn, by=str(deleted_by) if deleted_by else None)


# ============================================================================
# Membership
# ============================================================================


async def add_member(cn: str, uid: str, actor: UUID | None = None) -> GroupPublic:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    grp = await get_group(cn)
    ldap_client = get_ldap()

    # Önce user var mı?
    user_entry = ldap_client.search_user_by_uid(uid)
    if user_entry is None:
        raise NotFoundError(f"'{uid}' uid'li kullanıcı yok", code="USER_NOT_FOUND")

    if grp.group_type == "groupOfNames":
        member_value = user_entry["dn"]
        attr_name = "member"
    else:
        member_value = uid
        attr_name = "memberUid"

    with ldap_client.write() as conn:
        ok = conn.modify(grp.dn, {attr_name: [(MODIFY_ADD, [member_value])]})
        if not ok:
            # Zaten üye ise OK say
            if conn.result.get("result") == 20:  # attributeOrValueExists
                logger.info("ldap.group.member_already", cn=cn, uid=uid)
                return await get_group(cn)
            raise ValidationError(
                f"Üye ekleme başarısız: {conn.result.get('description')}",
                code="LDAP_MODIFY_FAILED",
            )

    logger.info("ldap.group.member_added", cn=cn, uid=uid, by=str(actor) if actor else None)
    return await get_group(cn)


async def remove_member(cn: str, uid: str, actor: UUID | None = None) -> GroupPublic:
    settings = get_settings()
    if not settings.is_master:
        raise ValidationError("Yalnızca master", code="READ_ONLY")

    grp = await get_group(cn)
    ldap_client = get_ldap()
    user_entry = ldap_client.search_user_by_uid(uid)
    if user_entry is None:
        raise NotFoundError(f"'{uid}' uid'li kullanıcı yok", code="USER_NOT_FOUND")

    if grp.group_type == "groupOfNames":
        member_value = user_entry["dn"]
        attr_name = "member"
    else:
        member_value = uid
        attr_name = "memberUid"

    with ldap_client.write() as conn:
        ok = conn.modify(grp.dn, {attr_name: [(MODIFY_DELETE, [member_value])]})
        if not ok:
            if conn.result.get("result") == 16:  # noSuchAttribute
                logger.info("ldap.group.member_not_in_group", cn=cn, uid=uid)
                return await get_group(cn)
            raise ValidationError(
                f"Üye çıkarma başarısız: {conn.result.get('description')}",
                code="LDAP_MODIFY_FAILED",
            )

    logger.info("ldap.group.member_removed", cn=cn, uid=uid, by=str(actor) if actor else None)
    return await get_group(cn)

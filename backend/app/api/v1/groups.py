# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Group (LDAP groupOfNames / posixGroup) CRUD endpoint'leri."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response

from app.api.deps import (
    CurrentAdmin,
    DbSession,
    get_request_meta,
    require_permission,
)
from app.core.logging import get_logger
from app.schemas.groups import (
    GroupCreateRequest,
    GroupListResponse,
    GroupMemberRequest,
    GroupPublic,
    GroupUpdateRequest,
)
from app.services import audit_service, ldap_group_service

logger = get_logger(__name__)

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get(
    "",
    response_model=GroupListResponse,
    summary="Grupları listele",
)
async def list_groups(
    _: Annotated[None, Depends(require_permission("group.read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    search: str | None = Query(None, max_length=128),
) -> GroupListResponse:
    result = await ldap_group_service.list_groups(page=page, page_size=page_size, search=search)
    return GroupListResponse(**result)


@router.get(
    "/{cn}",
    response_model=GroupPublic,
    summary="Tek grup detayı",
)
async def get_group(
    cn: str,
    _: Annotated[None, Depends(require_permission("group.read"))],
) -> GroupPublic:
    return await ldap_group_service.get_group(cn)


@router.post(
    "",
    response_model=GroupPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni grup oluştur",
)
async def create_group(
    payload: GroupCreateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("group.create"))],
) -> GroupPublic:
    group = await ldap_group_service.create_group(payload, created_by=current.id)
    await audit_service.log_event(
        db, category="GROUP", event_code="GROUP_CREATED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="GROUP", target_id=payload.cn, target_display=payload.cn,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"group_type": payload.group_type, "initial_members": len(payload.member_uids or [])},
    )
    await db.commit()
    return group


@router.patch(
    "/{cn}",
    response_model=GroupPublic,
    summary="Grup açıklamasını güncelle",
)
async def update_group(
    cn: str,
    payload: GroupUpdateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("group.update"))],
) -> GroupPublic:
    group = await ldap_group_service.update_group(cn, payload.description)
    await audit_service.log_event(
        db, category="GROUP", event_code="GROUP_UPDATED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="GROUP", target_id=cn,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"description": payload.description},
    )
    await db.commit()
    return group


@router.delete(
    "/{cn}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Grup sil",
)
async def delete_group(
    cn: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("group.delete"))],
) -> Response:
    await ldap_group_service.delete_group(cn, deleted_by=current.id)
    await audit_service.log_event(
        db, category="GROUP", event_code="GROUP_DELETED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="GROUP", target_id=cn,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{cn}/members",
    response_model=GroupPublic,
    summary="Gruba üye ekle",
)
async def add_group_member(
    cn: str,
    payload: GroupMemberRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("group.update"))],
) -> GroupPublic:
    group = await ldap_group_service.add_member(cn, payload.uid, actor=current.id)
    await audit_service.log_event(
        db, category="GROUP", event_code="GROUP_MEMBER_ADDED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="GROUP", target_id=cn,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"member_uid": payload.uid},
    )
    await db.commit()
    return group


@router.delete(
    "/{cn}/members/{uid}",
    response_model=GroupPublic,
    summary="Gruptan üye çıkar",
)
async def remove_group_member(
    cn: str,
    uid: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("group.update"))],
) -> GroupPublic:
    group = await ldap_group_service.remove_member(cn, uid, actor=current.id)
    await audit_service.log_event(
        db, category="GROUP", event_code="GROUP_MEMBER_REMOVED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="GROUP", target_id=cn,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"member_uid": uid},
    )
    await db.commit()
    return group

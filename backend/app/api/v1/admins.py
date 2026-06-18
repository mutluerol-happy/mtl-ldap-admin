# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Admin (DB-resident yönetici hesapları) CRUD endpoint'leri."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response

from app.api.deps import (
    CurrentAdmin,
    DbSession,
    get_request_meta,
    require_permission,
)
from app.core.logging import get_logger
from app.schemas.admins import (
    AdminCreateRequest,
    AdminListResponse,
    AdminPublicFull,
    AdminRoleAssignRequest,
    AdminUpdateRequest,
    AvailableLdapUsersResponse,
)
from app.schemas.users import AdminPasswordResetRequest
from app.services import admin_management_service, audit_service

logger = get_logger(__name__)

router = APIRouter(prefix="/admins", tags=["admins"])


@router.get(
    "",
    response_model=AdminListResponse,
    summary="Admin'leri listele",
)
async def list_admins(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("admin.read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    search: str | None = Query(None, max_length=128),
    is_active: bool | None = Query(None),
) -> AdminListResponse:
    result = await admin_management_service.list_admins(
        db, page=page, page_size=page_size, search=search, is_active=is_active
    )
    return AdminListResponse(**result)


@router.get(
    "/available-ldap-users",
    response_model=AvailableLdapUsersResponse,
    summary="Admin yaratırken seçilebilecek LDAP kullanıcılarını listele",
)
async def list_available_ldap_users(
    db: DbSession,
    current: CurrentAdmin,
    search: str | None = None,
    limit: int = 200,
) -> AvailableLdapUsersResponse:
    """ou=people altındaki kullanıcıları döner (zaten admin olanlar hariç).

    Query params:
        search: uid/cn/mail'de geçen substring (opsiyonel)
        limit: max kayıt (default 200)
    """
    result = await admin_management_service.list_available_ldap_users(
        db, search=search, limit=limit
    )
    return AvailableLdapUsersResponse(**result)


@router.get(
    "/{admin_id}",
    response_model=AdminPublicFull,
    summary="Tek admin detayı",
)
async def get_admin(
    admin_id: UUID,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("admin.read"))],
) -> AdminPublicFull:
    return await admin_management_service.get_admin(db, admin_id)


@router.post(
    "",
    response_model=AdminPublicFull,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni admin oluştur (DB + opsiyonel LDAP)",
)
async def create_admin(
    payload: AdminCreateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("admin.create"))],
) -> AdminPublicFull:
    admin = await admin_management_service.create_admin(db, payload, created_by=current.id)
    await audit_service.log_event(
        db, category="ADMIN", event_code="ADMIN_CREATED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ADMIN", target_id=str(admin.id), target_display=admin.username,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"username": payload.username, "roles": payload.role_names,
                 "create_in_ldap": payload.create_in_ldap},
    )
    await db.commit()
    return admin


@router.patch(
    "/{admin_id}",
    response_model=AdminPublicFull,
    summary="Admin bilgilerini güncelle",
)
async def update_admin(
    admin_id: UUID,
    payload: AdminUpdateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("admin.update"))],
) -> AdminPublicFull:
    admin = await admin_management_service.update_admin(db, admin_id, payload, updated_by=current.id)
    await audit_service.log_event(
        db, category="ADMIN", event_code="ADMIN_UPDATED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ADMIN", target_id=str(admin_id), target_display=admin.username,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None},
    )
    await db.commit()
    return admin


@router.delete(
    "/{admin_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Admin sil",
)
async def delete_admin(
    admin_id: UUID,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("admin.delete"))],
) -> Response:
    if admin_id == current.id:
        from app.core.exceptions import ValidationError
        raise ValidationError("Kendinizi silemezsiniz", code="CANNOT_DELETE_SELF")
    await admin_management_service.delete_admin(db, admin_id, deleted_by=current.id)
    await audit_service.log_event(
        db, category="ADMIN", event_code="ADMIN_DELETED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ADMIN", target_id=str(admin_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{admin_id}/assign-role",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Admin'e rol ata",
)
async def assign_role(
    admin_id: UUID,
    payload: AdminRoleAssignRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("admin.assign_role"))],
) -> Response:
    await admin_management_service.assign_role_to_admin(
        db, admin_id, payload.role_name, granted_by=current.id
    )
    await audit_service.log_event(
        db, category="RBAC", event_code="ROLE_ASSIGNED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ADMIN", target_id=str(admin_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"role_name": payload.role_name},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{admin_id}/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Admin'den rol kaldır",
)
async def revoke_role(
    admin_id: UUID,
    role_id: UUID,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("admin.assign_role"))],
) -> Response:
    await admin_management_service.revoke_role_from_admin(db, admin_id, role_id, revoked_by=current.id)
    await audit_service.log_event(
        db, category="RBAC", event_code="ROLE_REVOKED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ADMIN", target_id=str(admin_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"role_id": str(role_id)},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{admin_id}/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Admin parolasını sıfırla",
)
async def reset_admin_password(
    admin_id: UUID,
    payload: AdminPasswordResetRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("admin.reset_password"))],
) -> Response:
    await admin_management_service.admin_reset_password(
        db, admin_id, payload.new_password, payload.must_change, actor=current.id
    )
    await audit_service.log_event(
        db, category="SECURITY", event_code="ADMIN_PASSWORD_RESET", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ADMIN", target_id=str(admin_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"must_change": payload.must_change},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{admin_id}/reset-mfa",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Admin MFA'sını sıfırla",
)
async def reset_admin_mfa(
    admin_id: UUID,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("admin.reset_mfa"))],
) -> Response:
    await admin_management_service.admin_reset_mfa(db, admin_id, actor=current.id)
    await audit_service.log_event(
        db, category="SECURITY", event_code="ADMIN_MFA_RESET", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ADMIN", target_id=str(admin_id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
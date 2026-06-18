# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Role/Permission görüntüleme endpoint'leri (Tur 3 read-only)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import DbSession, require_permission
from app.schemas.rbac import (
    ModuleGroupedPermissions,
    PermissionListResponse,
    PermissionPublic,
    RoleDetailPublic,
    RoleListResponse,
)
from app.services import rbac_service

router = APIRouter(tags=["rbac"])


@router.get(
    "/roles",
    response_model=RoleListResponse,
    summary="Tüm rolleri listele",
)
async def list_roles(
    request: Request,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("role.read"))],
) -> RoleListResponse:
    roles = await rbac_service.list_roles(db, lang=getattr(request.state, "lang", "tr"))
    return RoleListResponse(total=len(roles), items=roles)


@router.get(
    "/roles/{name}",
    response_model=RoleDetailPublic,
    summary="Tek rol detayı (permission'larıyla birlikte)",
)
async def get_role(
    request: Request,
    name: str,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("role.read"))],
) -> RoleDetailPublic:
    return await rbac_service.get_role_by_name(db, name, lang=getattr(request.state, "lang", "tr"))


@router.get(
    "/permissions",
    response_model=PermissionListResponse,
    summary="Tüm permission'ları listele",
)
async def list_permissions(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("role.read"))],
) -> PermissionListResponse:
    perms = await rbac_service.list_permissions(db)
    return PermissionListResponse(total=len(perms), items=perms)


@router.get(
    "/permissions/grouped",
    response_model=list[ModuleGroupedPermissions],
    summary="Permission'ları module'a göre gruplayarak göster",
)
async def list_permissions_grouped(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("role.read"))],
) -> list[ModuleGroupedPermissions]:
    grouped = await rbac_service.list_permissions_grouped(db)
    return [ModuleGroupedPermissions(**g) for g in grouped]


# ============================================================================
# Tur 4: Mutation (role create/update/delete + permission CRUD)
# ============================================================================

from app.schemas.rbac_mutation import (  # noqa: E402
    PermissionCreateRequest,
    RoleCreateRequest,
    RolePermissionLinkRequest,
    RoleUpdateRequest,
)
from app.services import audit_service as _audit_service  # noqa: E402
from app.services import rbac_mutation_service  # noqa: E402
from app.api.deps import CurrentAdmin, get_request_meta  # noqa: E402
from fastapi import status  # noqa: E402
from fastapi.responses import Response  # noqa: E402


@router.post(
    "/roles",
    response_model=RoleDetailPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni rol oluştur",
)
async def create_role(
    payload: RoleCreateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("role.create"))],
) -> RoleDetailPublic:
    role = await rbac_mutation_service.create_role(db, payload, current.id)
    await _audit_service.log_event(
        db, category="RBAC", event_code="ROLE_CREATED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ROLE", target_id=payload.name, target_display=payload.name,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"permissions": payload.permission_codes,
                 "is_system": payload.is_system,
                 "requires_mfa": payload.requires_mfa},
    )
    await db.commit()
    return role


@router.patch(
    "/roles/{name}",
    response_model=RoleDetailPublic,
    summary="Rol güncelle",
)
async def update_role(
    name: str,
    payload: RoleUpdateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("role.update"))],
) -> RoleDetailPublic:
    role = await rbac_mutation_service.update_role(db, name, payload, current.id)
    await _audit_service.log_event(
        db, category="RBAC", event_code="ROLE_UPDATED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ROLE", target_id=name,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details=payload.model_dump(exclude_unset=True),
    )
    await db.commit()
    return role


@router.delete(
    "/roles/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Rol sil (sistem rolleri silinemez)",
)
async def delete_role(
    name: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("role.delete"))],
) -> Response:
    await rbac_mutation_service.delete_role(db, name, current.id)
    await _audit_service.log_event(
        db, category="RBAC", event_code="ROLE_DELETED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ROLE", target_id=name,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/roles/{name}/permissions",
    response_model=RoleDetailPublic,
    summary="Role permission ekle",
)
async def add_permission_to_role(
    name: str,
    payload: RolePermissionLinkRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("role.update"))],
) -> RoleDetailPublic:
    role = await rbac_mutation_service.add_permission_to_role(
        db, name, payload.permission_code, current.id
    )
    await _audit_service.log_event(
        db, category="RBAC", event_code="PERMISSION_GRANTED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ROLE", target_id=name,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"permission": payload.permission_code},
    )
    await db.commit()
    return role


@router.delete(
    "/roles/{name}/permissions/{permission_code}",
    response_model=RoleDetailPublic,
    summary="Rolden permission kaldır",
)
async def remove_permission_from_role(
    name: str,
    permission_code: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("role.update"))],
) -> RoleDetailPublic:
    role = await rbac_mutation_service.remove_permission_from_role(
        db, name, permission_code, current.id
    )
    await _audit_service.log_event(
        db, category="RBAC", event_code="PERMISSION_REVOKED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="ROLE", target_id=name,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"permission": permission_code},
    )
    await db.commit()
    return role


@router.post(
    "/permissions",
    response_model=PermissionPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni permission oluştur",
)
async def create_permission(
    payload: PermissionCreateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("role.update"))],
) -> PermissionPublic:
    perm = await rbac_mutation_service.create_permission(db, payload, current.id)
    await _audit_service.log_event(
        db, category="RBAC", event_code="PERMISSION_CREATED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="PERMISSION", target_id=payload.code,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"module": payload.module, "description": payload.description},
    )
    await db.commit()
    return PermissionPublic.model_validate(perm)

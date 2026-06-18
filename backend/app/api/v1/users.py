# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""User (LDAP end_user) CRUD endpoint'leri."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from fastapi.responses import Response

from app.api.deps import (
    CurrentAdmin,
    DbSession,
    get_request_meta,
    require_permission,
)
from app.core.exceptions import ValidationError
from app.core.logging import get_logger
from app.schemas.users import (
    AdminPasswordResetRequest,
    BulkImportJobPublic,
    BulkUserCreateRequest,
    PasswordChangeRequest,
    UserCreateRequest,
    UserListResponse,
    UserPublic,
    UserUpdateRequest,
)
from app.services import (
    audit_service,
    bulk_import_service,
    ldap_user_service,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


# ============================================================================
# List / Search
# ============================================================================


@router.get(
    "",
    response_model=UserListResponse,
    summary="Kullanıcıları listele (paginated, search)",
)
async def list_users(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("user.read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    search: str | None = Query(None, max_length=128),
) -> UserListResponse:
    result = await ldap_user_service.list_users(db, page=page, page_size=page_size, search=search)
    return UserListResponse(**result)


@router.get(
    "/{uid}",
    response_model=UserPublic,
    summary="Tek kullanıcı detayı",
)
async def get_user(
    uid: str,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("user.read"))],
) -> UserPublic:
    return await ldap_user_service.get_user(db, uid)


# ============================================================================
# Create / Update / Delete
# ============================================================================


@router.post(
    "",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni kullanıcı oluştur (LDAP + DB metadata)",
)
async def create_user(
    payload: UserCreateRequest,
    db: DbSession,
    current: CurrentAdmin,
    request: Request,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.create"))],
) -> UserPublic:
    user = await ldap_user_service.create_user(db, payload, created_by=current.id)
    await audit_service.log_event(
        db,
        category="USER",
        event_code="USER_CREATED",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="END_USER",
        target_id=payload.uid,
        target_display=payload.cn,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={"email": payload.email, "department": payload.department},
    )
    await db.commit()
    return user


@router.patch(
    "/{uid}",
    response_model=UserPublic,
    summary="Kullanıcı bilgilerini güncelle",
)
async def update_user(
    uid: str,
    payload: UserUpdateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.update"))],
) -> UserPublic:
    user = await ldap_user_service.update_user(db, uid, payload, updated_by=current.id)
    await audit_service.log_event(
        db,
        category="USER",
        event_code="USER_UPDATED",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="END_USER",
        target_id=uid,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None},
    )
    await db.commit()
    return user


@router.delete(
    "/{uid}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Kullanıcı sil",
)
async def delete_user(
    uid: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.delete"))],
) -> Response:
    await ldap_user_service.delete_user(db, uid, deleted_by=current.id)
    await audit_service.log_event(
        db,
        category="USER",
        event_code="USER_DELETED",
        severity="WARNING",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="END_USER",
        target_id=uid,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ============================================================================
# Password reset (admin tarafından)
# ============================================================================


@router.post(
    "/{uid}/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Admin tarafından parola sıfırlama",
)
async def reset_password(
    uid: str,
    payload: AdminPasswordResetRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.reset_password"))],
) -> Response:
    await ldap_user_service.reset_user_password(
        db, uid, payload.new_password, payload.must_change, reset_by=current.id
    )
    await audit_service.log_event(
        db,
        category="SECURITY",
        event_code="USER_PASSWORD_RESET",
        severity="WARNING",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="END_USER",
        target_id=uid,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={"must_change": payload.must_change},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ============================================================================
# MFA reset (admin tarafından)
# ============================================================================


@router.post(
    "/{uid}/reset-mfa",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Admin tarafından MFA sıfırlama (end_user'ın MFA'sını kapat)",
)
async def reset_mfa(
    uid: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.reset_mfa"))],
) -> Response:
    await ldap_user_service.admin_reset_mfa_for_user(db, uid, actor=current.id)
    await audit_service.log_event(
        db,
        category="SECURITY",
        event_code="USER_MFA_RESET",
        severity="WARNING",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="END_USER",
        target_id=uid,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ============================================================================
# Lock / Unlock / Activate / Deactivate
# ============================================================================


@router.post(
    "/{uid}/lock",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Kullanıcıyı kilitle (DB metadata)",
)
async def lock_user(
    uid: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.update"))],
) -> Response:
    await ldap_user_service.set_user_lock(db, uid, locked=True, actor=current.id)
    await audit_service.log_event(
        db,
        category="USER",
        event_code="USER_LOCKED",
        severity="WARNING",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="END_USER",
        target_id=uid,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{uid}/unlock",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Kullanıcıyı kilidi aç",
)
async def unlock_user(
    uid: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.update"))],
) -> Response:
    await ldap_user_service.set_user_lock(db, uid, locked=False, actor=current.id)
    await audit_service.log_event(
        db,
        category="USER",
        event_code="USER_UNLOCKED",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="END_USER",
        target_id=uid,
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{uid}/activate",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Kullanıcıyı aktifleştir",
)
async def activate_user(
    uid: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.update"))],
) -> Response:
    await ldap_user_service.set_user_active(db, uid, active=True, actor=current.id)
    await audit_service.log_event(
        db, category="USER", event_code="USER_ACTIVATED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="END_USER", target_id=uid,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{uid}/deactivate",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Kullanıcıyı devre dışı bırak",
)
async def deactivate_user(
    uid: str,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.update"))],
) -> Response:
    await ldap_user_service.set_user_active(db, uid, active=False, actor=current.id)
    await audit_service.log_event(
        db, category="USER", event_code="USER_DEACTIVATED", severity="NOTICE",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="END_USER", target_id=uid,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ============================================================================
# Bulk import
# ============================================================================


@router.post(
    "/bulk",
    response_model=BulkImportJobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    summary="JSON payload ile bulk user oluştur (≤500 senkron, üzeri async)",
)
async def bulk_create_json(
    payload: BulkUserCreateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.create"))],
) -> BulkImportJobPublic:
    job = await bulk_import_service.import_users_from_json(
        db,
        items=payload.items,
        on_conflict=payload.on_conflict,
        initiated_by=current.id,
    )
    await audit_service.log_event(
        db, category="USER", event_code="BULK_IMPORT_STARTED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="BULK_JOB", target_id=str(job.id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"total": len(payload.items), "on_conflict": payload.on_conflict},
    )
    await db.commit()
    return BulkImportJobPublic.model_validate(job)


@router.post(
    "/bulk/csv",
    response_model=BulkImportJobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    summary="CSV dosyası ile bulk user oluştur (her zaman async)",
)
async def bulk_create_csv(
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.create"))],
    file: UploadFile = File(...),
    on_conflict: str = Query("skip"),
) -> BulkImportJobPublic:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise ValidationError("Sadece .csv dosyaları kabul edilir", code="INVALID_FORMAT")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB max
        raise ValidationError("Dosya 10MB'tan büyük", code="FILE_TOO_LARGE")

    job = await bulk_import_service.import_users_from_csv(
        db,
        csv_content=content,
        filename=file.filename,
        on_conflict=on_conflict,
        initiated_by=current.id,
    )
    await audit_service.log_event(
        db, category="USER", event_code="BULK_IMPORT_CSV_STARTED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="BULK_JOB", target_id=str(job.id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"filename": file.filename, "size_bytes": len(content), "on_conflict": on_conflict},
    )
    await db.commit()
    return BulkImportJobPublic.model_validate(job)


@router.get(
    "/bulk/{job_id}",
    response_model=BulkImportJobPublic,
    summary="Bulk import durumu",
)
async def get_bulk_job(
    job_id: UUID,
    db: DbSession,
    _: Annotated[None, Depends(require_permission("user.read"))],
) -> BulkImportJobPublic:
    job = await bulk_import_service.get_job(db, job_id)
    return BulkImportJobPublic.model_validate(job)


# ============================================================================
# Tur 4: Bulk update / delete
# ============================================================================

from app.schemas.users_bulk import (  # noqa: E402
    BulkUserDeleteRequest,
    BulkUserUpdateRequest,
)


@router.post(
    "/bulk/update",
    response_model=BulkImportJobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Bulk user update (senkron, küçük setler için)",
)
async def bulk_update_users(
    payload: BulkUserUpdateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.update"))],
) -> BulkImportJobPublic:
    job = await bulk_import_service.bulk_update_users(
        db, items=payload.items, on_error=payload.on_error, initiated_by=current.id
    )
    await audit_service.log_event(
        db, category="USER", event_code="BULK_UPDATE_STARTED",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        target_type="BULK_JOB", target_id=str(job.id),
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"total": len(payload.items)},
    )
    await db.commit()
    return BulkImportJobPublic.model_validate(job)


@router.post(
    "/bulk/delete",
    response_model=BulkImportJobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Bulk user delete",
)
async def bulk_delete_users(
    payload: BulkUserDeleteRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("user.delete"))],
) -> BulkImportJobPublic:
    # ALERT: bulk_delete event'i tetiklenir (alert engine yakalar)
    await audit_service.log_event(
        db, category="USER", event_code="BULK_DELETE_STARTED", severity="WARNING",
        actor_type="ADMIN", actor_id=str(current.id), actor_display=current.username,
        ip_address=meta["ip"], user_agent=meta["user_agent"],
        details={"total": len(payload.uids), "uids_sample": payload.uids[:10]},
    )
    await db.flush()
    job = await bulk_import_service.bulk_delete_users(
        db, uids=payload.uids, on_error=payload.on_error, initiated_by=current.id
    )
    await db.commit()
    return BulkImportJobPublic.model_validate(job)

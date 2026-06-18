# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""System settings API endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status, Request
from fastapi.responses import Response

from app.api.deps import (
    CurrentAdmin,
    DbSession,
    get_request_meta,
    require_permission,
)
from app.core.logging import get_logger
from app.schemas.setting import (
    SettingsListResponse,
    SettingUpdateRequest,
    SmsTestRequest,
    SmsTestResponse,
    NotificationTestRequest,
    NotificationTestResponse,
    SmtpTestRequest,
    SystemInfoResponse,
)
from app.services import audit_service, settings_service, system_info_service

logger = get_logger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _can_view_sensitive(current: CurrentAdmin) -> bool:
    """super_admin VEYA settings.read_sensitive permission'ı olanlar açık değer görür."""
    roles = getattr(current, "roles", None) or []
    for r in roles:
        # super_admin = wildcard
        if getattr(r, "name", "") == "mtl.super_admin":
            return True
        for p in getattr(r, "permissions", None) or []:
            code = getattr(p, "code", "")
            if code in ("*", "settings.read_sensitive"):
                return True
    return False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get(
    "",
    response_model=SettingsListResponse,
    summary="Tüm sistem ayarlarını kategorize listele",
)
async def list_settings(request: Request, 
    db: DbSession,
    current: CurrentAdmin,
    _: Annotated[None, Depends(require_permission("settings.read"))],
) -> SettingsListResponse:
    include_sensitive = _can_view_sensitive(current)
    _dbg_lang = getattr(request.state, "lang", "tr"); print(f"[DEBUG] settings.list lang={_dbg_lang} accept={request.headers.get('"'"'accept-language'"'"')}", flush=True)
    data = await settings_service.list_all(db, include_sensitive=include_sensitive, lang=_dbg_lang)
    return SettingsListResponse(**data)


@router.patch(
    "/{category}/{key}",
    response_model=SettingsListResponse,
    summary="Tek ayar güncelle — güncellenmiş tüm listeyi döner",
)
async def update_setting(
    request: Request,
    category: str,
    key: str,
    payload: SettingUpdateRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("settings.write"))],
) -> SettingsListResponse:
    s, old_display, new_display = await settings_service.update_setting(
        db, category, key, payload.value, actor_id=current.id
    )

    await audit_service.log_event(
        db,
        category="ADMIN",
        event_code="SETTING_CHANGED",
        severity="WARNING" if s.is_sensitive else "NOTICE",
        actor_type="ADMIN",
        actor_id=str(current.id),
        actor_display=current.username,
        target_type="SETTING",
        target_id=f"{category}.{key}",
        target_display=f"{category}.{key}",
        ip_address=meta["ip"],
        user_agent=meta["user_agent"],
        details={
            "category": category,
            "key": key,
            "old_value": old_display,
            "new_value": new_display,
        },
    )
    await db.commit()

    include_sensitive = _can_view_sensitive(current)
    _dbg_lang = getattr(request.state, "lang", "tr"); print(f"[DEBUG] settings.list lang={_dbg_lang} accept={request.headers.get('"'"'accept-language'"'"')}", flush=True)
    data = await settings_service.list_all(db, include_sensitive=include_sensitive, lang=_dbg_lang)
    return SettingsListResponse(**data)


@router.post(
    "/smtp/test",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="SMTP yapılandırması ile test maili gönder",
)
async def smtp_test(
    payload: SmtpTestRequest,
    db: DbSession,
    current: CurrentAdmin,
    meta: Annotated[dict, Depends(get_request_meta)],
    _: Annotated[None, Depends(require_permission("settings.smtp_test"))],
) -> Response:
    success = True
    error_message: str | None = None
    try:
        await settings_service.send_smtp_test(db, payload.to_email)
    except Exception as e:
        success = False
        error_message = str(e)
        # Audit fail bile log'lansın
        await audit_service.log_event(
            db,
            category="ADMIN",
            event_code="SMTP_TEST_FAILED",
            severity="WARNING",
            actor_type="ADMIN",
            actor_id=str(current.id),
            actor_display=current.username,
            target_type="EMAIL",
            target_display=payload.to_email,
            ip_address=meta["ip"],
            user_agent=meta["user_agent"],
            details={"to": payload.to_email, "error": error_message},
        )
        await db.commit()
        raise  # ValidationError caller'a propagate, FastAPI 400 döner

    if success:
        await audit_service.log_event(
            db,
            category="ADMIN",
            event_code="SMTP_TEST_SENT",
            severity="NOTICE",
            actor_type="ADMIN",
            actor_id=str(current.id),
            actor_display=current.username,
            target_type="EMAIL",
            target_display=payload.to_email,
            ip_address=meta["ip"],
            user_agent=meta["user_agent"],
            details={"to": payload.to_email},
        )
        await db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/system-info",
    response_model=SystemInfoResponse,
    summary="Sistem bilgisi: versiyon, profile, servis durumları",
)
async def get_system_info(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("settings.read"))],
) -> SystemInfoResponse:
    data = await system_info_service.get_system_info(db)
    return SystemInfoResponse(**data)


@router.post(
    "/sms/test",
    response_model=SmsTestResponse,
    summary="SMS yapilandirmasini test et",
)
async def sms_test(
    payload: SmsTestRequest,
    db: DbSession,
    current: CurrentAdmin,
) -> SmsTestResponse:
    """Settings'teki saglayiciya 1 test SMS gonderir."""
    from app.services import sms_service
    result = await sms_service.send_test_sms(db, to=payload.to_number)
    return SmsTestResponse(
        ok=bool(result.get("ok")),
        provider=result.get("provider"),
        status=result.get("status"),
        error=result.get("error"),
        body=result.get("body"),
    )


@router.post(
    "/notifications/test",
    response_model=NotificationTestResponse,
    summary="Bildirim kanali test mesaji gonder (Slack/Teams/Webhook)",
)
async def notifications_test(
    payload: NotificationTestRequest,
    db: DbSession,
    current: CurrentAdmin,
) -> NotificationTestResponse:
    """Slack/Teams/Webhook kanalina test mesaji gonderir."""
    from app.services import notification_channels_service
    result = await notification_channels_service.send_test(db, channel=payload.channel)
    return NotificationTestResponse(
        ok=bool(result.get("ok")),
        channel=result.get("channel"),
        status=result.get("status"),
        error=result.get("error"),
        body=result.get("body"),
    )

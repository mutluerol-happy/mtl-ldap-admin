# SPDX-License-Identifier: Apache-2.0
"""Dashboard özet endpoint'i."""
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import DbSession, require_permission
from app.schemas.dashboard import DashboardSummary
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "/summary",
    response_model=DashboardSummary,
    summary="Dashboard ana sayfa için toplu özet",
)
async def get_dashboard_summary(
    db: DbSession,
    _: Annotated[None, Depends(require_permission("audit.events.read"))] = None,
) -> DashboardSummary:
    data = await dashboard_service.get_summary(db)
    return DashboardSummary(**data)

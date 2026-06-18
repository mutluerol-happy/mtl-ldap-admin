# SPDX-License-Identifier: Apache-2.0
"""Dashboard ana sayfa özet schema'sı."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.audit import EventLogPublic, IPStr


class ActiveAlert(BaseModel):
    """Henüz çözülmemiş alarm."""
    model_config = ConfigDict(from_attributes=True)

    id: IPStr = None
    rule_id: IPStr = None
    rule_code: str | None = None
    rule_name: str | None = None
    severity: str
    summary: str
    status: str
    triggered_at: datetime


class SecuritySummary(BaseModel):
    total_admins: int
    mfa_enrolled: int
    mfa_enrollment_pct: int
    locked_admins: int
    inactive_admins: int
    failed_login_24h: int


class DashboardSummary(BaseModel):
    recent_events: list[EventLogPublic]
    active_alerts: list[ActiveAlert]
    security: SecuritySummary

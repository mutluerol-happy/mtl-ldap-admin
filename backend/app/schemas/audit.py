# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Audit query API şemaları."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from pydantic import BeforeValidator, BaseModel, ConfigDict, Field


def _ip_to_str(v):
    """IPv4Address/IPv6Address objelerini string'e çevir (INET column dönüşümü)."""
    return str(v) if v is not None else None


IPStr = Annotated[str | None, BeforeValidator(_ip_to_str)]


class EventLogPublic(BaseModel):
    """Tek bir audit event."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    occurred_at: datetime
    server_node: str | None = None
    category: str
    event_code: str
    severity: str
    actor_type: str | None = None
    actor_id: str | None = None
    actor_display: str | None = None
    target_type: str | None = None
    target_id: str | None = None
    target_display: str | None = None
    ip_address: IPStr = None
    user_agent: str | None = None
    request_id: IPStr = None
    details: dict[str, Any] = Field(default_factory=dict)


class AuditEventListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[EventLogPublic]


class AuditSummaryBucket(BaseModel):
    bucket: str
    count: int


class AuditSummary(BaseModel):
    """Son N saatlik özet."""

    period_hours: int
    total_events: int
    by_severity: dict[str, int]
    by_category: dict[str, int]
    top_event_codes: list[dict[str, Any]]
    top_actors: list[dict[str, Any]]
    failed_login_count: int
    successful_login_count: int
    timeline: list[AuditSummaryBucket]

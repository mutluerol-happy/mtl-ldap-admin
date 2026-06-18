# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Alert rule + event şemaları."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AlertRulePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    rule_code: str
    name: str
    description: str | None = None
    severity: str
    rule_type: str
    enabled: bool
    threshold_count: int
    window_minutes: int
    cooldown_minutes: int
    notify_channels: list[str] = Field(default_factory=list)
    extra_config: dict[str, Any] = Field(default_factory=dict)
    last_triggered_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AlertRuleUpdateRequest(BaseModel):
    enabled: bool | None = None
    severity: Literal["INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"] | None = None
    threshold_count: int | None = Field(None, ge=1, le=10000)
    window_minutes: int | None = Field(None, ge=1, le=10080)
    cooldown_minutes: int | None = Field(None, ge=0, le=1440)
    description: str | None = Field(None, max_length=512)
    notify_channels: list[str] | None = None
    extra_config: dict[str, Any] | None = None


class AlertEventPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    rule_id: UUID
    triggered_at: datetime
    severity: str
    summary: str
    event_count: int
    window_start: datetime | None
    window_end: datetime | None
    status: str
    acknowledged_at: datetime | None
    acknowledged_by: UUID | None
    resolved_at: datetime | None
    resolved_by: UUID | None
    resolution_note: str | None
    matched_events: list[dict[str, Any]] = Field(default_factory=list)
    extra_details: dict[str, Any] = Field(default_factory=dict)


class AlertEventListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[AlertEventPublic]


class AlertAckRequest(BaseModel):
    note: str | None = Field(None, max_length=1024)


class AlertResolveRequest(BaseModel):
    note: str = Field(..., min_length=1, max_length=2048)

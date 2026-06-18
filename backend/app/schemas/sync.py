# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""LDAP ↔ DB sync şemaları."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SyncDiscrepancyPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    discovered_at: datetime
    discrepancy_type: str
    subject_type: str
    subject_id: str
    ldap_dn: str | None = None
    db_id: UUID | None = None
    diff_details: dict[str, Any] = Field(default_factory=dict)
    resolved_at: datetime | None = None
    resolved_by: UUID | None = None
    resolution_action: str | None = None


class SyncStatusSummary(BaseModel):
    last_scan_at: datetime | None
    total_ldap_users: int
    total_db_users: int
    in_sync_count: int
    discrepancy_count: int
    by_type: dict[str, int]
    unresolved: list[SyncDiscrepancyPublic]


class SyncResolveRequest(BaseModel):
    discrepancy_id: UUID
    action: Literal["create_ldap", "create_db", "sync_attribute", "ignore", "delete_db", "delete_ldap"]

# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Cluster node şemaları."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ClusterNodePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    node_id: str
    node_type: str
    hostname: str
    base_url: str
    status: str
    last_heartbeat_at: datetime | None = None
    last_sync_at: datetime | None = None
    version: str | None = None
    extra_metadata: dict[str, Any] = Field(default_factory=dict)
    registered_at: datetime
    updated_at: datetime


class NodeRegisterRequest(BaseModel):
    node_id: str = Field(..., min_length=3, max_length=64)
    node_type: Literal["MASTER", "SLAVE"]
    hostname: str = Field(..., min_length=3, max_length=255)
    base_url: str = Field(..., min_length=8, max_length=512)
    version: str | None = Field(None, max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


class HeartbeatRequest(BaseModel):
    node_id: str
    status: Literal["online", "offline", "degraded", "syncing"] = "online"
    version: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class HeartbeatResponse(BaseModel):
    accepted: bool
    cluster_time: datetime
    master_node_id: str | None = None


class ClusterStatusSummary(BaseModel):
    master_node_id: str | None
    total_nodes: int
    online_nodes: int
    offline_nodes: int
    degraded_nodes: int
    queue_pending: int
    queue_failed: int
    last_sync_at: datetime | None
    nodes: list[ClusterNodePublic]


class SyncQueueItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    target_node_id: str
    payload_type: str
    queued_at: datetime
    attempts: int
    max_attempts: int
    next_attempt_at: datetime
    last_attempt_at: datetime | None
    last_error: str | None
    status: str
    sent_at: datetime | None


class SyncReceiveRequest(BaseModel):
    """Slave'in master'dan aldığı audit event payload."""

    payload_type: Literal["AUDIT_EVENT"] = "AUDIT_EVENT"
    source_node_id: str
    events: list[dict[str, Any]]



# ===== TUR 13 ŞEMALARI =====


class AdminNodeAddRequest(BaseModel):
    """Admin UI'dan manuel node ekleme (admin-auth, HMAC değil)."""

    node_id: str = Field(..., min_length=3, max_length=64, examples=["mtl-slave-02"])
    node_type: Literal["MASTER", "SLAVE"] = "SLAVE"
    hostname: str = Field(..., min_length=3, max_length=255, examples=["mtl-slave-02.mtl.local"])
    base_url: str = Field(..., min_length=8, max_length=512, examples=["https://mtl-slave-02.mtl.local"])
    version: str | None = Field(None, max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SyncStateNode(BaseModel):
    node_id: str
    node_type: str
    base_url: str
    csn: str | None = None
    in_sync: bool
    reachable: bool


class SyncStateResponse(BaseModel):
    master_node_id: str | None
    master_csn: str | None
    nodes: list[SyncStateNode]
    checked_at: str


class ProvisionRequest(BaseModel):
    """Panel-driven consumer provision istegi (admin-auth, master-only)."""

    node_id: str = Field(..., min_length=3, max_length=64, examples=["mtl-slave-02"])
    hostname: str = Field(..., min_length=3, max_length=255, examples=["mtl-slave-02.mtl.local"])
    ip: str = Field(..., pattern=r"^[0-9]{1,3}(\.[0-9]{1,3}){3}$", examples=["192.0.2.45"])


class ProvisionResponse(BaseModel):
    node: ClusterNodePublic
    bootstrap_command: str
    expires_at: datetime

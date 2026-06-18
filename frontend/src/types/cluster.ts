// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend: app/schemas/cluster.py

export type NodeType = "MASTER" | "SLAVE";

export type NodeStatusValue = "online" | "offline" | "degraded" | "syncing";

export interface ClusterNode {
  id: string;
  node_id: string;
  node_type: string; // NodeType
  hostname: string;
  base_url: string;
  status: string; // NodeStatusValue
  last_heartbeat_at: string | null;
  last_sync_at: string | null;
  version: string | null;
  extra_metadata: Record<string, unknown>;
  registered_at: string;
  updated_at: string;
}

export interface ClusterStatusSummary {
  master_node_id: string | null;
  total_nodes: number;
  online_nodes: number;
  offline_nodes: number;
  degraded_nodes: number;
  queue_pending: number;
  queue_failed: number;
  last_sync_at: string | null;
  nodes: ClusterNode[];
}

export type QueueItemStatus = "pending" | "sent" | "failed" | "abandoned";

export interface SyncQueueItem {
  id: string;
  target_node_id: string;
  payload_type: string;
  queued_at: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  status: string; // QueueItemStatus
  sent_at: string | null;
}

export interface QueueQuery {
  status?: string;
  limit?: number;
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// TUR 13 — types/cluster.ts SONUNA eklenecek tipler.

export interface NodeAddPayload {
  node_id: string;
  node_type: "MASTER" | "SLAVE";
  hostname: string;
  base_url: string;
  version?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SyncStateNode {
  node_id: string;
  node_type: string;
  base_url: string;
  csn: string | null;
  in_sync: boolean;
  reachable: boolean;
}

export interface SyncStateResponse {
  master_node_id: string | null;
  master_csn: string | null;
  nodes: SyncStateNode[];
  checked_at: string;
}

// SPDX-License-Identifier: Apache-2.0
// TUR 15 — panel-driven consumer provision.

export interface ProvisionPayload {
  node_id: string;
  hostname: string;
  ip: string;
}

export interface ProvisionResponse {
  node: ClusterNode;
  bootstrap_command: string;
  expires_at: string;
}

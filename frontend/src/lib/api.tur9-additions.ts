// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend Tur 9 — audit / alerts / cluster / sync API çağrıları.
// apiClient.baseURL = "/api/v1" — path'lere prefix EKLEMEYIZ.

import type {
  AuditEventListResponse,
  AuditEventQuery,
  AuditSummary,
  EventLog,
} from "@/types/audit";
import type {
  AlertAckPayload,
  AlertEvent,
  AlertEventListResponse,
  AlertEventQuery,
  AlertResolvePayload,
  AlertRule,
  AlertRuleUpdatePayload,
} from "@/types/alert";
import type {
  ClusterNode,
  ClusterStatusSummary,
  QueueQuery,
  SyncQueueItem,
  NodeAddPayload,
  ProvisionPayload,
  ProvisionResponse,
  SyncStateResponse,

} from "@/types/cluster";
import type {
  SyncResolvePayload,
  SyncStatusSummary,
} from "@/types/sync";

import { apiClient } from "./api";

// ============================================================================
// Audit (5 endpoint) — prefix /audit
// ============================================================================
export const auditApi = {
  listEvents: (q: AuditEventQuery = {}) =>
    apiClient
      .get<AuditEventListResponse>("/audit/events", { params: q })
      .then((r) => r.data),

  getEvent: (eventId: string) =>
    apiClient
      .get<EventLog>(`/audit/events/${encodeURIComponent(eventId)}`)
      .then((r) => r.data),

  listCategories: () =>
    apiClient.get<string[]>("/audit/categories").then((r) => r.data),

  listEventCodes: () =>
    apiClient.get<string[]>("/audit/event-codes").then((r) => r.data),

  listServerNodes: () =>
    apiClient.get<string[]>("/audit/server-nodes").then((r) => r.data),

  getSummary: (hours = 24) =>
    apiClient
      .get<AuditSummary>("/audit/summary", { params: { hours } })
      .then((r) => r.data),
};

// ============================================================================
// Alerts (6 endpoint) — prefix /alerts
// ============================================================================
export const alertsApi = {
  // Rules
  listRules: () =>
    apiClient.get<AlertRule[]>("/alerts/rules").then((r) => r.data),

  updateRule: (ruleId: string, payload: AlertRuleUpdatePayload) =>
    apiClient
      .patch<AlertRule>(
        `/alerts/rules/${encodeURIComponent(ruleId)}`,
        payload,
      )
      .then((r) => r.data),

  // Events
  listEvents: (q: AlertEventQuery = {}) =>
    apiClient
      .get<AlertEventListResponse>("/alerts", { params: q })
      .then((r) => r.data),

  getEvent: (eventId: string) =>
    apiClient
      .get<AlertEvent>(`/alerts/${encodeURIComponent(eventId)}`)
      .then((r) => r.data),

  acknowledge: (eventId: string, payload: AlertAckPayload) =>
    apiClient
      .post<AlertEvent>(
        `/alerts/${encodeURIComponent(eventId)}/acknowledge`,
        payload,
      )
      .then((r) => r.data),

  resolve: (eventId: string, payload: AlertResolvePayload) =>
    apiClient
      .post<AlertEvent>(
        `/alerts/${encodeURIComponent(eventId)}/resolve`,
        payload,
      )
      .then((r) => r.data),
};

// ============================================================================
// Cluster (3 admin endpoint) — prefix /cluster
// ============================================================================
export const clusterApi = {
  getStatus: () =>
    apiClient
      .get<ClusterStatusSummary>("/cluster/status")
      .then((r) => r.data),

  listNodes: () =>
    apiClient.get<ClusterNode[]>("/cluster/nodes").then((r) => r.data),

  listQueue: (q: QueueQuery = {}) =>
    apiClient
      .get<SyncQueueItem[]>("/cluster/queue", { params: q })
      .then((r) => r.data),
  addNode: (payload: NodeAddPayload) =>
    apiClient.post<ClusterNode>("/cluster/nodes", payload).then((r) => r.data),

  deleteNode: (nodeId: string) =>
    apiClient
      .delete(`/cluster/nodes/${encodeURIComponent(nodeId)}`)
      .then(() => undefined),

  provision: (payload: ProvisionPayload) =>
    apiClient
      .post<ProvisionResponse>("/cluster/provision", payload)
      .then((r) => r.data),

  getSyncState: () =>
    apiClient.get<SyncStateResponse>("/cluster/sync-state").then((r) => r.data),

};

// ============================================================================
// Sync (3 endpoint) — DİKKAT prefix /admin (sync.py router'da)
// ============================================================================
export const syncApi = {
  getStatus: () =>
    apiClient
      .get<SyncStatusSummary>("/admin/sync-status")
      .then((r) => r.data),

  triggerScan: () =>
    apiClient
      .post<Record<string, unknown>>("/admin/sync-scan")
      .then((r) => r.data),

  resolve: (payload: SyncResolvePayload) =>
    apiClient
      .post<void>("/admin/sync-resolve", payload)
      .then(() => undefined),
};

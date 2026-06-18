// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend: app/schemas/audit.py — EventLogPublic, AuditEventListResponse, AuditSummary

export type AuditSeverity =
  | "INFO"
  | "NOTICE"
  | "WARNING"
  | "ERROR"
  | "CRITICAL";

export interface EventLog {
  id: string;
  occurred_at: string;
  server_node: string | null;
  category: string;
  event_code: string;
  severity: string; // AuditSeverity (string olarak gelir)
  actor_type: string | null;
  actor_id: string | null;
  actor_display: string | null;
  target_type: string | null;
  target_id: string | null;
  target_display: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  details: Record<string, unknown>;
}

export interface AuditEventListResponse {
  total: number;
  page: number;
  page_size: number;
  items: EventLog[];
}

export interface AuditSummaryBucket {
  bucket: string;
  count: number;
}

export interface AuditSummary {
  period_hours: number;
  total_events: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  top_event_codes: Array<{ event_code: string; count: number } & Record<string, unknown>>;
  top_actors: Array<{ actor_id?: string; actor_display?: string; count: number } & Record<string, unknown>>;
  failed_login_count: number;
  successful_login_count: number;
  timeline: AuditSummaryBucket[];
}

export interface AuditEventQuery {
  page?: number;
  page_size?: number;
  category?: string;
  event_code?: string;
  severity?: string;
  actor_id?: string;
  actor_display?: string;
  target_id?: string;
  ip_address?: string;
  server_node?: string;
  search?: string;
  date_from?: string; // ISO
  date_to?: string; // ISO
}

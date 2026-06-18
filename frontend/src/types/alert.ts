// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend: app/schemas/alert.py

export type AlertSeverity =
  | "INFO"
  | "NOTICE"
  | "WARNING"
  | "ERROR"
  | "CRITICAL";

export type AlertEventStatus = "open" | "acknowledged" | "resolved" | "suppressed";

export interface AlertRule {
  id: string;
  rule_code: string;
  name: string;
  description: string | null;
  severity: string;
  rule_type: string;
  enabled: boolean;
  threshold_count: number;
  window_minutes: number;
  cooldown_minutes: number;
  notify_channels: string[];
  extra_config: Record<string, unknown>;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleUpdatePayload {
  enabled?: boolean | null;
  severity?: AlertSeverity | null;
  threshold_count?: number | null;
  window_minutes?: number | null;
  cooldown_minutes?: number | null;
  description?: string | null;
  notify_channels?: string[] | null;
  extra_config?: Record<string, unknown> | null;
}

export interface AlertEvent {
  id: string;
  rule_id: string;
  triggered_at: string;
  severity: string;
  summary: string;
  event_count: number;
  window_start: string | null;
  window_end: string | null;
  status: string; // AlertEventStatus
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  matched_events: Array<Record<string, unknown>>;
  extra_details: Record<string, unknown>;
}

export interface AlertEventListResponse {
  total: number;
  page: number;
  page_size: number;
  items: AlertEvent[];
}

export interface AlertEventQuery {
  page?: number;
  page_size?: number;
  status?: string;
  severity?: string;
  rule_id?: string;
}

export interface AlertAckPayload {
  note?: string | null;
}

export interface AlertResolvePayload {
  note: string; // required, min 1
}

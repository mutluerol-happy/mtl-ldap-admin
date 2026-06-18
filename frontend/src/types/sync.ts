// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend: app/schemas/sync.py — LDAP↔DB tutarsızlık şemaları.

export type DiscrepancyAction =
  | "create_ldap"
  | "create_db"
  | "sync_attribute"
  | "ignore"
  | "delete_db"
  | "delete_ldap";

export const DISCREPANCY_ACTIONS: { value: DiscrepancyAction; label: string; description: string; danger?: boolean }[] = [
  { value: "create_ldap", label: "LDAP'te oluştur", description: "DB'de var, LDAP'te yok — LDAP'e ekle" },
  { value: "create_db", label: "DB'de oluştur", description: "LDAP'te var, DB'de yok — DB'ye ekle" },
  { value: "sync_attribute", label: "Öznitelik senkronize et", description: "Aynı kullanıcı, farklı değerler — LDAP'ten DB'ye kopyala" },
  { value: "ignore", label: "Yoksay", description: "Bu tutarsızlığı görmezden gel (resolved olarak işaretle)" },
  { value: "delete_db", label: "DB'den sil", description: "LDAP yok ise DB kaydını sil", danger: true },
  { value: "delete_ldap", label: "LDAP'ten sil", description: "DB yok ise LDAP kaydını sil", danger: true },
];

export interface SyncDiscrepancy {
  id: string;
  discovered_at: string;
  discrepancy_type: string;
  subject_type: string;
  subject_id: string;
  ldap_dn: string | null;
  db_id: string | null;
  diff_details: Record<string, unknown>;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_action: string | null;
}

export interface SyncStatusSummary {
  last_scan_at: string | null;
  total_ldap_users: number;
  total_db_users: number;
  in_sync_count: number;
  discrepancy_count: number;
  by_type: Record<string, number>;
  unresolved: SyncDiscrepancy[];
}

export interface SyncResolvePayload {
  discrepancy_id: string;
  action: DiscrepancyAction;
}

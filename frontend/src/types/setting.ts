// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

export type SettingValueType = "string" | "integer" | "boolean" | "json";

export interface SystemSettingItem {
  id: string;
  category: string;
  key: string;
  /** Parsed value. Hassas + okuma yetkisi yoksa "***" string'i döner. */
  value: unknown | null;
  is_set: boolean;
  value_type: SettingValueType;
  is_sensitive: boolean;
  is_editable: boolean;
  description: string | null;
  default_value: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface SettingsCategoryResponse {
  category: string;
  title: string;
  description: string | null;
  settings: SystemSettingItem[];
}

export interface SettingsListResponse {
  categories: SettingsCategoryResponse[];
}

export interface SettingUpdatePayload {
  value: unknown; // int/bool/str/dict
}

export interface SmtpTestPayload {
  to_email: string;
}

export interface ServiceStatus {
  name: string;
  status: string; // "active" | "inactive" | "failed" | "unknown"
}

export interface SystemInfoResponse {
  version: string;
  profile: string;
  node_id: string;
  install_date: string | null;
  python_version: string;
  fastapi_version: string | null;
  db_name: string | null;
  db_version: string | null;
  redis_version: string | null;
  ldap_uri: string | null;
  ldap_base_dn: string | null;
  services: ServiceStatus[];
}

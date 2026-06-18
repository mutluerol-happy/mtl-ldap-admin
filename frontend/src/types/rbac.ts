// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

export interface Permission {
  id: string;
  code: string;
  module: string;
  description: string | null;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  requires_mfa: boolean;
  permission_count: number;
  permissions: string[]; // permission code'ları
}

export interface ModuleGroup {
  module: string;
  permissions: Permission[];
}

export interface RoleListResponse {
  total: number;
  items: Role[];
}

export interface PermissionListResponse {
  total: number;
  items: Permission[];
}

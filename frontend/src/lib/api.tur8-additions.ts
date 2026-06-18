// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend Tur 3 (admins + rbac) ile birebir uyumlu API çağrıları.
// apiClient.baseURL = "/api/v1" — path'lere prefix EKLEMEYIZ.

import type { PaginatedResponse } from "@/types/common";
import type {
  Admin,
  AdminCreatePayload,
  AdminUpdatePayload,
  AdminRoleAssignPayload,
  AdminPasswordResetPayload,
  AdminListQuery,
} from "@/types/admin";
import type {
  Role,
  RoleListResponse,
  ModuleGroup,
  PermissionListResponse,
} from "@/types/rbac";

import { apiClient } from "./api";

// ----------------------------------------------------------------------------
// admins
// ----------------------------------------------------------------------------
export const adminsApi = {
  list: (q: AdminListQuery = {}) =>
    apiClient
      .get<PaginatedResponse<Admin>>("/admins", { params: q })
      .then((r) => r.data),

  get: (adminId: string) =>
    apiClient
      .get<Admin>(`/admins/${encodeURIComponent(adminId)}`)
      .then((r) => r.data),

  create: (payload: AdminCreatePayload) =>
    apiClient.post<Admin>("/admins", payload).then((r) => r.data),

  update: (adminId: string, payload: AdminUpdatePayload) =>
    apiClient
      .patch<Admin>(`/admins/${encodeURIComponent(adminId)}`, payload)
      .then((r) => r.data),

  delete: (adminId: string) =>
    apiClient
      .delete<void>(`/admins/${encodeURIComponent(adminId)}`)
      .then(() => undefined),

  // Backend: POST /admins/{id}/assign-role  body: { role_name }
  assignRole: (adminId: string, payload: AdminRoleAssignPayload) =>
    apiClient
      .post<void>(
        `/admins/${encodeURIComponent(adminId)}/assign-role`,
        payload,
      )
      .then(() => undefined),

  // Backend: DELETE /admins/{admin_id}/roles/{role_id}  — role_id UUID
  revokeRole: (adminId: string, roleId: string) =>
    apiClient
      .delete<void>(
        `/admins/${encodeURIComponent(adminId)}/roles/${encodeURIComponent(roleId)}`,
      )
      .then(() => undefined),

  resetPassword: (adminId: string, payload: AdminPasswordResetPayload) =>
    apiClient
      .post<void>(
        `/admins/${encodeURIComponent(adminId)}/reset-password`,
        payload,
      )
      .then(() => undefined),

  resetMfa: (adminId: string) =>
    apiClient
      .post<void>(`/admins/${encodeURIComponent(adminId)}/reset-mfa`)
      .then(() => undefined),
};

// ----------------------------------------------------------------------------
// roles (read-only listeleme + detay)
// ----------------------------------------------------------------------------
export const rolesApi = {
  list: () =>
    apiClient.get<RoleListResponse>("/roles").then((r) => r.data),

  get: (name: string) =>
    apiClient
      .get<Role>(`/roles/${encodeURIComponent(name)}`)
      .then((r) => r.data),
};

// ----------------------------------------------------------------------------
// permissions
// ----------------------------------------------------------------------------
export const permissionsApi = {
  list: () =>
    apiClient
      .get<PermissionListResponse>("/permissions")
      .then((r) => r.data),

  /** Modüllere göre gruplu permission listesi (UI'da kategorize ekran için). */
  grouped: () =>
    apiClient.get<ModuleGroup[]>("/permissions/grouped").then((r) => r.data),
};

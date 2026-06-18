// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend Tur 5 ile birebir uyumlu API çağrıları.
// apiClient.baseURL = "/api/v1" — path'lere prefix EKLEMEYIZ.

import type { PaginatedResponse, BulkImportJob } from "@/types/common";
import type {
  User,
  UserCreatePayload,
  UserUpdatePayload,
  UserPasswordResetPayload,
  UserListQuery,
} from "@/types/user";
import type {
  Group,
  GroupCreatePayload,
  GroupUpdatePayload,
  GroupListQuery,
} from "@/types/group";

import { apiClient } from "./api";

// ----------------------------------------------------------------------------
// users
// ----------------------------------------------------------------------------
export const usersApi = {
  list: (q: UserListQuery = {}) =>
    apiClient
      .get<PaginatedResponse<User>>("/users", { params: q })
      .then((r) => r.data),

  get: (uid: string) =>
    apiClient
      .get<User>(`/users/${encodeURIComponent(uid)}`)
      .then((r) => r.data),

  create: (payload: UserCreatePayload) =>
    apiClient.post<User>("/users", payload).then((r) => r.data),

  update: (uid: string, payload: UserUpdatePayload) =>
    apiClient
      .patch<User>(`/users/${encodeURIComponent(uid)}`, payload)
      .then((r) => r.data),

  delete: (uid: string) =>
    apiClient
      .delete<void>(`/users/${encodeURIComponent(uid)}`)
      .then(() => undefined),

  // Status değişimleri — 204 No Content
  activate: (uid: string) =>
    apiClient
      .post<void>(`/users/${encodeURIComponent(uid)}/activate`)
      .then(() => undefined),

  deactivate: (uid: string) =>
    apiClient
      .post<void>(`/users/${encodeURIComponent(uid)}/deactivate`)
      .then(() => undefined),

  lock: (uid: string) =>
    apiClient
      .post<void>(`/users/${encodeURIComponent(uid)}/lock`)
      .then(() => undefined),

  unlock: (uid: string) =>
    apiClient
      .post<void>(`/users/${encodeURIComponent(uid)}/unlock`)
      .then(() => undefined),

  // Admin tarafından parola sıfırlama (manuel parola)
  // AdminPasswordResetRequest: { new_password, must_change }
  resetPassword: (uid: string, payload: UserPasswordResetPayload) =>
    apiClient
      .post<void>(
        `/users/${encodeURIComponent(uid)}/reset-password`,
        payload,
      )
      .then(() => undefined),

  resetMfa: (uid: string) =>
    apiClient
      .post<void>(`/users/${encodeURIComponent(uid)}/reset-mfa`)
      .then(() => undefined),

  // Backend'de ayrı endpoint yok.
  // Bir grup listesini çekip içinde kullanıcının DN'i geçenleri filtreliyoruz.
  groups: async (uid: string): Promise<Group[]> => {
    const all = await apiClient
      .get<PaginatedResponse<Group>>("/groups", {
        params: { page: 1, page_size: 500 },
      })
      .then((r) => r.data);
    const userDnPrefix = `uid=${uid},`;
    return all.items.filter((g) =>
      (g.member_dns ?? []).some((dn) =>
        dn.toLowerCase().startsWith(userDnPrefix.toLowerCase()),
      ),
    );
  },
};

// ----------------------------------------------------------------------------
// groups
// ----------------------------------------------------------------------------
export const groupsApi = {
  list: (q: GroupListQuery = {}) =>
    apiClient
      .get<PaginatedResponse<Group>>("/groups", { params: q })
      .then((r) => r.data),

  get: (cn: string) =>
    apiClient
      .get<Group>(`/groups/${encodeURIComponent(cn)}`)
      .then((r) => r.data),

  create: (payload: GroupCreatePayload) =>
    apiClient.post<Group>("/groups", payload).then((r) => r.data),

  update: (cn: string, payload: GroupUpdatePayload) =>
    apiClient
      .patch<Group>(`/groups/${encodeURIComponent(cn)}`, payload)
      .then((r) => r.data),

  delete: (cn: string) =>
    apiClient
      .delete<void>(`/groups/${encodeURIComponent(cn)}`)
      .then(() => undefined),

  addMember: (cn: string, uid: string) =>
    apiClient
      .post<Group>(`/groups/${encodeURIComponent(cn)}/members`, { uid })
      .then((r) => r.data),

  removeMember: (cn: string, uid: string) =>
    apiClient
      .delete<Group>(
        `/groups/${encodeURIComponent(cn)}/members/${encodeURIComponent(uid)}`,
      )
      .then((r) => r.data),
};

// ----------------------------------------------------------------------------
// bulk
// Backend yapısı: /users/bulk/csv (CSV upload), /users/bulk/{job_id} (status)
// Group bulk endpoint'i yok.
// ----------------------------------------------------------------------------
export const bulkApi = {
  importUsersCsv: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiClient
      .post<BulkImportJob>("/users/bulk/csv", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  importGroupsCsv: (_file: File): Promise<BulkImportJob> =>
    Promise.reject(
      new Error("Grup toplu içe aktarımı backend tarafından desteklenmiyor."),
    ),

  job: (jobId: string) =>
    apiClient
      .get<BulkImportJob>(`/users/bulk/${encodeURIComponent(jobId)}`)
      .then((r) => r.data),

  listJobs: (
    _params: { page?: number; page_size?: number } = {},
  ): Promise<PaginatedResponse<BulkImportJob>> =>
    Promise.reject(
      new Error("Bulk job listesi backend tarafından desteklenmiyor."),
    ),

  cancelJob: (_jobId: string): Promise<BulkImportJob> =>
    Promise.reject(
      new Error("Bulk job iptali backend tarafından desteklenmiyor."),
    ),
};

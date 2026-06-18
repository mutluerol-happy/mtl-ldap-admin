// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend Tur 3 (admins) — AdminPublicFull / AdminCreateRequest / AdminUpdateRequest.

export interface Admin {
  id: string; // UUID
  username: string;
  display_name: string;
  email: string;
  is_active: boolean;
  mfa_enabled: boolean;
  ldap_dn: string | null;
  must_change_password: boolean;
  password_changed_at: string | null;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  security_flags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  roles: string[]; // role name'leri (örn. ["mtl.super_admin"])
  permissions: string[]; // efektif permission code'ları
}

export interface AdminCreatePayload {
  username: string;
  display_name: string;
  email: string;
  password?: string;
  role_names: string[];
  must_change_password?: boolean;
  create_in_ldap?: boolean;
  link_existing_uid?: string | null;
}

export interface AdminUpdatePayload {
  display_name?: string | null;
  email?: string | null;
  is_active?: boolean | null;
  must_change_password?: boolean | null;
  security_flags?: Record<string, unknown> | null;
}

export interface AdminRoleAssignPayload {
  role_name: string;
}

export interface AdminPasswordResetPayload {
  new_password: string;
  must_change?: boolean;
}

export type AdminListQuery = {
  page?: number;
  page_size?: number;
  search?: string;
  is_active?: boolean;
};

/** UI'da hesaplanan durum (active/disabled/locked) — User'la aynı mantık. */
export type AdminStatusUI = "active" | "disabled" | "locked";

export function computeAdminStatus(a: Admin): AdminStatusUI {
  const lockedNow =
    a.locked_until !== null && new Date(a.locked_until).getTime() > Date.now();
  if (lockedNow) return "locked";
  if (!a.is_active) return "disabled";
  return "active";
}

/** Backend parola complexity'sine eşdeğer client-side kontrol. */
export function validateAdminPassword(p: string): string | null {
  if (p.length < 12) return "Parola en az 12 karakter olmalı";
  if (!/[A-Z]/.test(p)) return "En az bir büyük harf gerekli";
  if (!/[a-z]/.test(p)) return "En az bir küçük harf gerekli";
  if (!/\d/.test(p)) return "En az bir rakam gerekli";
  if (!/[!@#$%^&*()_+\-=[\]{};:'",.<>?/\\|`~]/.test(p))
    return "En az bir özel karakter gerekli";
  return null;
}

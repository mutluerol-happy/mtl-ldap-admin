// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend Tur 5 — UserPublic / UserCreateRequest / UserUpdateRequest ile birebir.

export interface User {
  // LDAP attributes
  uid: string;
  dn: string;
  cn: string;
  sn: string | null;
  given_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  department: string | null;
  preferred_language: "tr" | "en" | string | null;

  // DB metadata
  metadata_id: string | null;
  is_active: boolean;
  is_locked: boolean;
  locked_until: string | null;
  failed_login_count: number;
  mfa_enabled: boolean;
  mfa_enrolled_at: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  must_change_password: boolean;
  password_changed_at: string | null;
  password_expires_at: string | null;
  security_flags: Record<string, unknown>;
  ldap_sync_status: string;
}

export interface UserCreatePayload {
  uid: string;
  cn: string;
  sn: string;
  given_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  department?: string | null;
  password: string;
  must_change_password?: boolean;
  preferred_language?: "tr" | "en";
}

export interface UserUpdatePayload {
  cn?: string | null;
  sn?: string | null;
  given_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  department?: string | null;
  is_active?: boolean | null;
  preferred_language?: "tr" | "en" | null;
}

/** Backend AdminPasswordResetRequest — admin manuel parola atar. */
export interface UserPasswordResetPayload {
  new_password: string;
  must_change?: boolean;
}

export type UserListQuery = {
  page?: number;
  page_size?: number;
  search?: string;
};

/** UI'da status hesabı: is_active + is_locked + locked_until → 3 değer */
export type UserStatusUI = "active" | "disabled" | "locked";

export function computeUserStatus(u: User): UserStatusUI {
  const lockedNow =
    u.is_locked ||
    (u.locked_until !== null && new Date(u.locked_until).getTime() > Date.now());
  if (lockedNow) return "locked";
  if (!u.is_active) return "disabled";
  return "active";
}

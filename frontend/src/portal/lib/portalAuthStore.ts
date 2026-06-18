// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// End-user portal auth store. Admin auth'tan TAMAMEN ayrı:
//   - Farklı localStorage key (mtl-portal-session)
//   - Opaque token (Tur 5: Redis'te 30dk TTL, Bearer)
//   - useAuthStore (admin) ile karışmaz

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PortalUser {
  uid: string;
  username: string;
  display_name: string | null;
  email: string | null;
  mail?: string | null;
  phone?: string | null;
  mfa_enabled?: boolean;
  must_change_password?: boolean;
}

interface PortalAuthState {
  token: string | null;
  expires_at: string | null;
  user: PortalUser | null;
  setSession: (token: string, expires_at: string, user: PortalUser) => void;
  setUser: (user: PortalUser) => void;
  clear: () => void;
  isAuthenticated: () => boolean;
}

export const usePortalAuthStore = create<PortalAuthState>()(
  persist(
    (set, get) => ({
      token: null,
      expires_at: null,
      user: null,
      setSession: (token, expires_at, user) => set({ token, expires_at, user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, expires_at: null, user: null }),
      isAuthenticated: () => {
        const { token, expires_at } = get();
        if (!token) return false;
        if (!expires_at) return true;
        try {
          return new Date(expires_at).getTime() > Date.now();
        } catch {
          return true;
        }
      },
    }),
    {
      name: "mtl-portal-session",
    },
  ),
);

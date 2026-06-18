// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Auth state — Zustand. Tokens localStorage'da persist olur.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { AdminPublic, TokenPair } from "./api";

interface AuthState {
  tokens: TokenPair | null;
  user: AdminPublic | null;
  setSession: (tokens: TokenPair, user: AdminPublic) => void;
  updateTokens: (tokens: TokenPair) => void;
  updateUser: (user: AdminPublic) => void;
  clearSession: () => void;
  hasPermission: (perm: string) => boolean;
  hasRole: (role: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      tokens: null,
      user: null,

      setSession: (tokens, user) => set({ tokens, user }),

      updateTokens: (tokens) => set({ tokens }),

      updateUser: (user) => set({ user }),

      clearSession: () => {
        set({ tokens: null, user: null });
      },

      hasPermission: (perm) => {
        const u = get().user;
        if (!u) return false;
        return u.permissions.includes("*") || u.permissions.includes(perm);
      },

      hasRole: (role) => {
        const u = get().user;
        if (!u) return false;
        return u.roles.some((r) => r.name === role);
      },
    }),
    {
      name: "mtl-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ tokens: s.tokens, user: s.user }),
    },
  ),
);

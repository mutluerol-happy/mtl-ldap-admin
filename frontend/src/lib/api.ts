// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// API client. Backend Tur 1-5'in tüm endpoint'leri için tip-güvenli sarmalayıcı.
import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

import { useAuthStore } from "./auth";

// ============================================================================
// Axios instance
// ============================================================================

const API_BASE = "/api/v1";

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

// Request interceptor — token ekle
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // i18n: X-Lang custom header (Accept-Language Chrome tarafından override ediliyor)
  const lang = localStorage.getItem("mtl-lang") || "tr";
  config.headers["X-Lang"] = lang;
  config.headers["Accept-Language"] = lang;  // best-effort, browser override edebilir

  const tokens = useAuthStore.getState().tokens;
  if (tokens?.access_token && !config.headers.has("Authorization")) {
    config.headers.set("Authorization", `Bearer ${tokens.access_token}`);
  }
  return config;
});

// Response interceptor — 401 → refresh dene, başarısızsa logout
let isRefreshing = false;
let refreshQueue: ((token: string) => void)[] = [];

apiClient.interceptors.response.use(
  (resp) => resp,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/auth/login") &&
      !originalRequest.url?.includes("/auth/refresh")
    ) {
      originalRequest._retry = true;
      const tokens = useAuthStore.getState().tokens;
      if (!tokens?.refresh_token) {
        useAuthStore.getState().clearSession();
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Refresh devam ediyor — kuyruğa al
        return new Promise((resolve, reject) => {
          refreshQueue.push((newToken) => {
            originalRequest.headers?.set("Authorization", `Bearer ${newToken}`);
            apiClient.request(originalRequest).then(resolve).catch(reject);
          });
        });
      }

      isRefreshing = true;
      try {
        const refreshResp = await axios.post(
          `${API_BASE}/auth/refresh`,
          { refresh_token: tokens.refresh_token },
          { headers: { "Content-Type": "application/json" } },
        );
        const newTokens = refreshResp.data;
        useAuthStore.getState().updateTokens(newTokens);
        refreshQueue.forEach((cb) => cb(newTokens.access_token));
        refreshQueue = [];
        originalRequest.headers?.set("Authorization", `Bearer ${newTokens.access_token}`);
        return apiClient.request(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().clearSession();
        refreshQueue = [];
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ============================================================================
// Tip tanımları (backend şemalarıyla eşleşir)
// ============================================================================

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface RolePublic {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  requires_mfa: boolean;
}

export interface AdminPublic {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean;
  mfa_enabled: boolean;
  last_login_at: string | null;
  roles: RolePublic[];
  permissions: string[];
}

export interface LoginResponse {
  mfa_required: boolean;
  mfa_challenge_id: string | null;
  must_setup_mfa: boolean;
  mfa_setup_token: string | null;
  tokens: TokenPair | null;
  user: AdminPublic | null;
  password_change_required: boolean;
  password_change_token: string | null;
}

export interface MfaSetupResponse {
  secret: string;
  qr_code_url: string;
  qr_code_data_uri: string;
  recovery_codes: string[];
}

export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Endpoint sarmalayıcıları
// ============================================================================

export const api = {
  // Health
  health: () => apiClient.get("/health").then((r) => r.data),

  // Auth
  login: (username: string, password: string) =>
    apiClient
      .post<LoginResponse>("/auth/login", { username, password })
      .then((r) => r.data),

  loginWithMfa: (mfa_challenge_id: string, totp_code: string) =>
    apiClient
      .post<LoginResponse>("/auth/mfa/challenge", { mfa_challenge_id, totp_code })
      .then((r) => r.data),

  mfaSetup: (setupToken: string) =>
    apiClient
      .post<MfaSetupResponse>(
        "/auth/mfa/setup",
        {},
        { headers: { "X-MFA-Setup-Token": setupToken } },
      )
      .then((r) => r.data),

  mfaVerify: (setupToken: string, totp_code: string) =>
    apiClient
      .post<LoginResponse>(
        "/auth/mfa/verify",
        { totp_code },
        { headers: { "X-MFA-Setup-Token": setupToken } },
      )
      .then((r) => r.data),

  refresh: (refresh_token: string) =>
    apiClient
      .post<TokenPair>("/auth/refresh", { refresh_token })
      .then((r) => r.data),

  logout: (refresh_token: string) =>
    apiClient.post("/auth/logout", { refresh_token }).then((r) => r.data),

  me: () => apiClient.get<AdminPublic>("/auth/me").then((r) => r.data),
  sessionPolicy: () =>
    apiClient
      .get<{ idle_timeout_minutes: number }>("/auth/session-policy")
      .then((r) => r.data),

  changeOwnPassword: (current_password: string, new_password: string) =>
    apiClient
      .post("/auth/change-password", { current_password, new_password })
      .then((r) => r.data),

  changePasswordWithToken: (changeToken: string, current_password: string, new_password: string) =>
    apiClient
      .post(
        "/auth/change-password-with-token",
        { current_password, new_password },
        { headers: { "X-Password-Change-Token": changeToken } },
      )
      .then((r) => r.data),

  // Cluster (özet için dashboard'da kullanılır)
  clusterStatus: () => apiClient.get("/cluster/status").then((r) => r.data),

  // Audit (dashboard summary için)
  auditSummary: (hours = 24) =>
    apiClient.get(`/audit/summary?hours=${hours}`).then((r) => r.data),
};

export { apiClient };

export function extractApiError(err: unknown): { message: string; code?: string } {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiError | undefined;
    if (data?.error) {
      // `error` string olabilir veya nesne ({message, details, code}) olabilir.
      const e = data.error as unknown as { message?: string; code?: string } | string;
      if (typeof e === "string") return { message: e, code: data.code };
      return {
        message: typeof e?.message === "string" ? e.message : JSON.stringify(e),
        code: data.code ?? e?.code,
      };
    }
    if (err.message) return { message: err.message };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: "Beklenmedik bir hata oluştu" };
}

// ============================================================================
// Tur 7 modülleri (users / groups / bulk)
// ============================================================================
export { usersApi, groupsApi, bulkApi } from "./api.tur7-additions";

// ============================================================================
// Tur 8 modülleri (admins / roles / permissions)
// ============================================================================
export { adminsApi, rolesApi, permissionsApi } from "./api.tur8-additions";

// ============================================================================
// Tur 9 modülleri (audit / alerts / cluster / sync)
// ============================================================================
export { auditApi, alertsApi, clusterApi, syncApi } from "./api.tur9-additions";

// ============================================================================
// Tur 10 modülü (sistem ayarları)
// ============================================================================
export { settingsApi } from "./api.tur10-additions";

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend (Tur 5) → frontend internal tip adaptasyonu
//   Request : {uid, password}              Frontend: {username, password}
//   Response: {access_token, expires_in}   Frontend: {token, expires_at}
//   MFA     : {mfa_challenge_id, totp_code} Frontend: {challenge_id, code}

import axios, { type AxiosInstance, type AxiosError } from "axios";

import { usePortalAuthStore, type PortalUser } from "./portalAuthStore";
import { portalPath } from "./portalRoutes";

export interface PortalPasswordPolicy {
  min_length: number;
  max_length: number;
  require_upper: boolean;
  require_lower: boolean;
  require_digit: boolean;
  require_special: boolean;
  reset_channel?: "email" | "sms" | "both";
}

export interface ResetRequestPayload {
  username: string;
  email?: string;
  phone?: string;
  channel?: "email" | "sms";
}
export interface ResetVerifyPayload { username: string; otp_code: string; }
export interface ResetVerifyResponse { completion_token: string; expires_in_seconds: number; }
export interface ResetCompletePayload { completion_token: string; new_password: string; }

export interface PortalLoginPayload { username: string; password: string; }

// Frontend tarafı — adapter sonrası
export interface PortalLoginResponse {
  token?: string;
  expires_at?: string;
  user?: PortalUser;
  mfa_required?: boolean;
  mfa_challenge_id?: string;
  must_change_password?: boolean;
}

export interface PortalMfaChallengePayload { challenge_id: string; code: string; }

export interface PortalMfaSetupResponse {
  secret: string;
  qr_code_uri: string;
  qr_code_image?: string;
}
export interface PortalMfaVerifyPayload { code: string; }
export interface PortalChangePasswordPayload { current_password: string; new_password: string; }
export interface PortalProfileUpdatePayload {
  display_name?: string;
  email?: string;
  phone?: string;
}

// ============================================================================
// Axios
// ============================================================================
const portalClient: AxiosInstance = axios.create({
  baseURL: "/api/v1",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

portalClient.interceptors.request.use((config) => {
  const token = usePortalAuthStore.getState().token;
  if (token && !config.headers.has("Authorization")) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});


// Request interceptor: X-Lang custom header (Chrome Accept-Language override için)
portalClient.interceptors.request.use((config) => {
  const lang = (typeof localStorage !== "undefined" && localStorage.getItem("mtl-lang")) || "tr";
  config.headers = config.headers ?? {};
  config.headers["X-Lang"] = lang;
  config.headers["Accept-Language"] = lang;
  return config;
});

portalClient.interceptors.response.use(
  (resp) => resp,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const store = usePortalAuthStore.getState();
      if (store.token) {
        store.clear();
        if (typeof window !== "undefined") {
          window.location.href = portalPath("login");
        }
      }
    }
    return Promise.reject(error);
  },
);

// ============================================================================
// Adapter: backend user → frontend PortalUser
// ============================================================================
function adaptUser(b: any): PortalUser | undefined {
  if (!b) return undefined;
  return {
    uid: b.uid ?? b.username ?? "",
    username: b.uid ?? b.username ?? "",
    display_name: b.display_name ?? null,
    email: b.mail ?? b.email ?? null,
    mail: b.mail ?? null,
    phone: b.phone ?? b.telephone ?? b.mobile ?? null,
    mfa_enabled: b.mfa_enabled ?? false,
    must_change_password: b.must_change_password ?? false,
  };
}

function adaptLoginResponse(d: any): PortalLoginResponse {
  const expiresIn = d.expires_in as number | undefined;
  return {
    token: d.access_token ?? d.token,
    expires_at: expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : (d.expires_at as string | undefined),
    user: adaptUser(d.user),
    mfa_required: d.mfa_required ?? false,
    mfa_challenge_id: d.mfa_challenge_id ?? undefined,
    must_change_password: d.must_change_password ?? d.user?.must_change_password ?? false,
  };
}

// ============================================================================
// API
// ============================================================================
export const portalApi = {
  // ---- Anonim reset ----
  getResetPolicy: async (): Promise<PortalPasswordPolicy> => {
    const { data } = await portalClient.get("/reset/policy");
    return data;
  },

  resetRequest: async (payload: ResetRequestPayload): Promise<{ message: string }> => {
    const { data } = await portalClient.post("/reset/request", {
      uid: payload.username,
      email: payload.email,
      phone: payload.phone,
      channel: payload.channel,
    });
    return data;
  },

  resetVerify: async (payload: ResetVerifyPayload): Promise<ResetVerifyResponse> => {
    const { data } = await portalClient.post("/reset/verify", {
      uid: payload.username,
      otp: payload.otp_code,
    });
    return data;
  },

  resetComplete: async (payload: ResetCompletePayload): Promise<{ message: string }> => {
    const { data } = await portalClient.post("/reset/complete", payload);
    return data;
  },

  // ---- Login ----
  login: async (payload: PortalLoginPayload): Promise<PortalLoginResponse> => {
    const { data } = await portalClient.post("/me/login", {
      uid: payload.username,
      password: payload.password,
    });
    return adaptLoginResponse(data);
  },

  loginWithMfa: async (payload: PortalMfaChallengePayload): Promise<PortalLoginResponse> => {
    const { data } = await portalClient.post("/me/mfa/challenge", {
      mfa_challenge_id: payload.challenge_id,
      totp_code: payload.code,
    });
    return adaptLoginResponse(data);
  },

  logout: async (): Promise<void> => {
    try {
      await portalClient.post("/me/logout");
    } catch {
      /* yutuldu */
    }
  },

  // ---- /me ----
  getProfile: async (): Promise<PortalUser> => {
    const { data } = await portalClient.get("/me");
    return adaptUser(data) ?? ({} as PortalUser);
  },

  updateProfile: async (payload: PortalProfileUpdatePayload): Promise<PortalUser> => {
    const { data } = await portalClient.patch("/me", payload);
    return adaptUser(data) ?? ({} as PortalUser);
  },

  changePassword: async (payload: PortalChangePasswordPayload): Promise<void> => {
    await portalClient.post("/me/change-password", payload);
  },

  // ---- MFA ----
  mfaSetup: async (): Promise<PortalMfaSetupResponse> => {
    const { data } = await portalClient.post("/me/mfa/setup");
    return {
      secret: data.secret ?? "",
      qr_code_uri: data.qr_code_uri ?? data.otpauth_uri ?? "",
      qr_code_image: data.qr_code_image ?? data.qr_code_png ?? undefined,
    };
  },

  mfaVerify: async (payload: PortalMfaVerifyPayload): Promise<void> => {
    await portalClient.post("/me/mfa/verify", {
      totp_code: payload.code,
    });
  },

  mfaDisable: async (payload: { password: string }): Promise<void> => {
    await portalClient.post("/me/mfa/disable", payload);
  },
};

export function extractPortalError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { detail?: string; error?: { message?: string } }
      | string
      | undefined;
    if (typeof data === "string") return data;
    return data?.error?.message ?? data?.detail ?? err.message ?? "Beklenmeyen hata";
  }
  return err instanceof Error ? err.message : "Beklenmeyen hata";
}

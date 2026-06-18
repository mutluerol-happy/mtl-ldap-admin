// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Tur 10 — Sistem Ayarları API client
import axios, { type AxiosInstance } from "axios";

import { useAuthStore } from "./auth";
import type {
  SettingsListResponse,
  SettingUpdatePayload,
  SmtpTestPayload,
  SystemInfoResponse,
} from "@/types/setting";

// Aynı axios instance pattern'ini kullan (lib/api.ts'tekiyle uyumlu)
const apiClient: AxiosInstance = axios.create({
  baseURL: "/api/v1",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  // i18n: X-Lang custom header (Accept-Language Chrome tarafından override edilebilir)
  const lang = localStorage.getItem("mtl-lang") || "tr";
  config.headers.set("X-Lang", lang);
  config.headers.set("Accept-Language", lang);

  const tokens = useAuthStore.getState().tokens;
  if (tokens?.access_token && !config.headers.has("Authorization")) {
    config.headers.set("Authorization", `Bearer ${tokens.access_token}`);
  }
  return config;
});

export const settingsApi = {
  list: async (): Promise<SettingsListResponse> => {
    const { data } = await apiClient.get<SettingsListResponse>("/settings");
    return data;
  },

  update: async (
    category: string,
    key: string,
    payload: SettingUpdatePayload,
  ): Promise<SettingsListResponse> => {
    const { data } = await apiClient.patch<SettingsListResponse>(
      `/settings/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
      payload,
    );
    return data;
  },

  smtpTest: async (payload: SmtpTestPayload): Promise<void> => {
    await apiClient.post("/settings/smtp/test", payload);
  },
  smsTest: async (payload: { to_number?: string }): Promise<{
    ok: boolean;
    provider?: string;
    status?: number;
    error?: string;
    body?: string;
  }> => {
    const { data } = await apiClient.post("/settings/sms/test", payload);
    return data;
  },
  notificationsTest: async (payload: { channel: "slack" | "teams" | "webhook" }): Promise<{
    ok: boolean;
    channel?: string;
    status?: number;
    error?: string;
    body?: string;
  }> => {
    const { data } = await apiClient.post("/settings/notifications/test", payload);
    return data;
  },

  systemInfo: async (): Promise<SystemInfoResponse> => {
    const { data } = await apiClient.get<SystemInfoResponse>("/settings/system-info");
    return data;
  },
};

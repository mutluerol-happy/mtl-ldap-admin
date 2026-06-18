// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { settingsApi } from "@/lib/api.tur10-additions";
import type {
  SettingUpdatePayload,
  SettingsListResponse,
  SmtpTestPayload,
  SystemInfoResponse,
} from "@/types/setting";

export const settingsKeys = {
  all: ["settings"] as const,
  list: () => [...settingsKeys.all, "list"] as const,
  systemInfo: () => [...settingsKeys.all, "system-info"] as const,
};

export function useSettings() {
  return useQuery<SettingsListResponse>({
    queryKey: settingsKeys.list(),
    queryFn: () => settingsApi.list(),
    staleTime: 30_000,
  });
}

export function useUpdateSetting(category: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SettingUpdatePayload) =>
      settingsApi.update(category, key, payload),
    onSuccess: (data) => {
      // Backend güncel listeyi döner — direkt cache'e koy
      qc.setQueryData(settingsKeys.list(), data);
      toast.success(`${key} güncellendi`);
    },
    onError: () => {
      // Tek tek hata mesajını caller dialog yakalar
    },
  });
}

export function useSmtpTest() {
  return useMutation({
    mutationFn: (payload: SmtpTestPayload) => settingsApi.smtpTest(payload),
    onSuccess: (_data, vars) => {
      toast.success(`Test maili gönderildi: ${vars.to_email}`);
    },
  });
}

export function useSystemInfo() {
  return useQuery<SystemInfoResponse>({
    queryKey: settingsKeys.systemInfo(),
    queryFn: () => settingsApi.systemInfo(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}


// ============================================================================
// Tur D2 — SMS Test
// ============================================================================
export function useSmsTest() {
  return useMutation({
    mutationFn: (payload: { to_number?: string }) => settingsApi.smsTest(payload),
    onSuccess: (data: any) => {
      if (data?.ok) {
        toast.success(`Test SMS gönderildi (${data.provider})`);
      } else {
        toast.error(`SMS gönderilemedi: ${data?.error ?? "bilinmeyen hata"}`);
      }
    },
  });
}


// ============================================================================
// Tur D — Notification Channels Test (Slack/Teams/Webhook)
// ============================================================================
export function useNotificationsTest() {
  return useMutation({
    mutationFn: (payload: { channel: "slack" | "teams" | "webhook" }) =>
      settingsApi.notificationsTest(payload),
    onSuccess: (data: any) => {
      if (data?.ok) {
        toast.success(`Test bildirimi gönderildi (${data.channel})`);
      } else {
        toast.error(`Bildirim gönderilemedi: ${data?.error ?? "bilinmeyen hata"}`);
      }
    },
  });
}

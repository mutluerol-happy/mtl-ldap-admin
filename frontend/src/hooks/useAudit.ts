// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { auditApi } from "@/lib/api.tur9-additions";
import type { AuditEventQuery } from "@/types/audit";

export const auditKeys = {
  all: ["audit"] as const,
  events: () => [...auditKeys.all, "events"] as const,
  eventList: (q: AuditEventQuery) => [...auditKeys.events(), q] as const,
  event: (id: string) => [...auditKeys.all, "event", id] as const,
  categories: () => [...auditKeys.all, "categories"] as const,
  eventCodes: () => [...auditKeys.all, "event-codes"] as const,
  serverNodes: () => [...auditKeys.all, "server-nodes"] as const,
  summary: (hours: number) => [...auditKeys.all, "summary", hours] as const,
};

export function useAuditEvents(query: AuditEventQuery) {
  return useQuery({
    queryKey: auditKeys.eventList(query),
    queryFn: () => auditApi.listEvents(query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useAuditEvent(id: string | undefined) {
  return useQuery({
    queryKey: id ? auditKeys.event(id) : ["audit", "event", "__none__"],
    queryFn: () => auditApi.getEvent(id as string),
    enabled: !!id,
  });
}

export function useAuditCategories() {
  return useQuery({
    queryKey: auditKeys.categories(),
    queryFn: () => auditApi.listCategories(),
    staleTime: 5 * 60_000,
  });
}

export function useAuditEventCodes() {
  return useQuery({
    queryKey: auditKeys.eventCodes(),
    queryFn: () => auditApi.listEventCodes(),
    staleTime: 5 * 60_000,
  });
}

export function useAuditServerNodes() {
  return useQuery({
    queryKey: auditKeys.serverNodes(),
    queryFn: () => auditApi.listServerNodes(),
    staleTime: 5 * 60_000,
  });
}

export function useAuditSummary(hours = 24) {
  return useQuery({
    queryKey: auditKeys.summary(hours),
    queryFn: () => auditApi.getSummary(hours),
    staleTime: 60_000,
    // Otomatik yenile — Audit panel canlı bir akış olsun
    refetchInterval: 60_000,
  });
}

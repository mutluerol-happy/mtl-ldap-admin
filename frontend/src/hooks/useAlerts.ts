// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { alertsApi } from "@/lib/api.tur9-additions";
import type {
  AlertAckPayload,
  AlertEventQuery,
  AlertResolvePayload,
  AlertRuleUpdatePayload,
} from "@/types/alert";

export const alertKeys = {
  all: ["alerts"] as const,
  rules: () => [...alertKeys.all, "rules"] as const,
  events: () => [...alertKeys.all, "events"] as const,
  eventList: (q: AlertEventQuery) => [...alertKeys.events(), q] as const,
  event: (id: string) => [...alertKeys.all, "event", id] as const,
};

// ----------------------------------------------------------------------------
// Rules
// ----------------------------------------------------------------------------
export function useAlertRules() {
  return useQuery({
    queryKey: alertKeys.rules(),
    queryFn: () => alertsApi.listRules(),
    staleTime: 60_000,
  });
}

export function useUpdateAlertRule(ruleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AlertRuleUpdatePayload) =>
      alertsApi.updateRule(ruleId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.rules() }),
  });
}

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------
export function useAlertEvents(query: AlertEventQuery) {
  return useQuery({
    queryKey: alertKeys.eventList(query),
    queryFn: () => alertsApi.listEvents(query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useAlertEvent(id: string | undefined) {
  return useQuery({
    queryKey: id ? alertKeys.event(id) : ["alerts", "event", "__none__"],
    queryFn: () => alertsApi.getEvent(id as string),
    enabled: !!id,
  });
}

export function useAcknowledgeAlert(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AlertAckPayload) =>
      alertsApi.acknowledge(eventId, payload),
    onSuccess: (ev) => {
      qc.setQueryData(alertKeys.event(eventId), ev);
      qc.invalidateQueries({ queryKey: alertKeys.events() });
    },
  });
}

export function useResolveAlert(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AlertResolvePayload) =>
      alertsApi.resolve(eventId, payload),
    onSuccess: (ev) => {
      qc.setQueryData(alertKeys.event(eventId), ev);
      qc.invalidateQueries({ queryKey: alertKeys.events() });
    },
  });
}

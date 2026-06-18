// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { syncApi } from "@/lib/api.tur9-additions";
import type { SyncResolvePayload } from "@/types/sync";

export const syncKeys = {
  all: ["sync"] as const,
  status: () => [...syncKeys.all, "status"] as const,
};

export function useSyncStatus() {
  return useQuery({
    queryKey: syncKeys.status(),
    queryFn: () => syncApi.getStatus(),
    staleTime: 30_000,
  });
}

export function useTriggerSyncScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncApi.triggerScan(),
    onSuccess: () => qc.invalidateQueries({ queryKey: syncKeys.status() }),
  });
}

export function useResolveSyncDiscrepancy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SyncResolvePayload) => syncApi.resolve(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: syncKeys.status() }),
  });
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clusterApi } from "@/lib/api.tur9-additions";
import type { NodeAddPayload, ProvisionPayload, QueueQuery } from "@/types/cluster";

export const clusterKeys = {
  all: ["cluster"] as const,
  status: () => [...clusterKeys.all, "status"] as const,
  nodes: () => [...clusterKeys.all, "nodes"] as const,
  queue: (q: QueueQuery) => [...clusterKeys.all, "queue", q] as const,
  syncState: () => [...clusterKeys.all, "sync-state"] as const,
};

export function useClusterStatus() {
  return useQuery({
    queryKey: clusterKeys.status(),
    queryFn: () => clusterApi.getStatus(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useClusterNodes() {
  return useQuery({
    queryKey: clusterKeys.nodes(),
    queryFn: () => clusterApi.listNodes(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useClusterQueue(query: QueueQuery = {}) {
  return useQuery({
    queryKey: clusterKeys.queue(query),
    queryFn: () => clusterApi.listQueue(query),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useSyncState() {
  return useQuery({
    queryKey: clusterKeys.syncState(),
    queryFn: () => clusterApi.getSyncState(),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

export function useAddNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: NodeAddPayload) => clusterApi.addNode(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clusterKeys.nodes() });
      qc.invalidateQueries({ queryKey: clusterKeys.status() });
      qc.invalidateQueries({ queryKey: clusterKeys.syncState() });
    },
  });
}

export function useProvisionNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProvisionPayload) => clusterApi.provision(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clusterKeys.nodes() });
      qc.invalidateQueries({ queryKey: clusterKeys.status() });
      qc.invalidateQueries({ queryKey: clusterKeys.syncState() });
    },
  });
}

export function useDeleteNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) => clusterApi.deleteNode(nodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clusterKeys.nodes() });
      qc.invalidateQueries({ queryKey: clusterKeys.status() });
      qc.invalidateQueries({ queryKey: clusterKeys.syncState() });
    },
  });
}

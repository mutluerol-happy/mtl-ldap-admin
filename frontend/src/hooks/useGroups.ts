// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { groupsApi } from "@/lib/api.tur7-additions";
import type {
  GroupCreatePayload,
  GroupListQuery,
  GroupUpdatePayload,
} from "@/types/group";

export const groupKeys = {
  all: ["groups"] as const,
  lists: () => [...groupKeys.all, "list"] as const,
  list: (q: GroupListQuery) => [...groupKeys.lists(), q] as const,
  details: () => [...groupKeys.all, "detail"] as const,
  detail: (cn: string) => [...groupKeys.details(), cn] as const,
};

export function useGroupsList(query: GroupListQuery) {
  return useQuery({
    queryKey: groupKeys.list(query),
    queryFn: () => groupsApi.list(query),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useGroup(cn: string | undefined) {
  return useQuery({
    queryKey: cn ? groupKeys.detail(cn) : ["groups", "detail", "__none__"],
    queryFn: () => groupsApi.get(cn as string),
    enabled: !!cn,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GroupCreatePayload) => groupsApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupKeys.lists() }),
  });
}

export function useUpdateGroup(cn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GroupUpdatePayload) => groupsApi.update(cn, payload),
    onSuccess: (group) => {
      qc.setQueryData(groupKeys.detail(cn), group);
      qc.invalidateQueries({ queryKey: groupKeys.lists() });
    },
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cn: string) => groupsApi.delete(cn),
    onSuccess: (_, cn) => {
      qc.removeQueries({ queryKey: groupKeys.detail(cn) });
      qc.invalidateQueries({ queryKey: groupKeys.lists() });
    },
  });
}

export function useAddGroupMember(cn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uid: string) => groupsApi.addMember(cn, uid),
    onSuccess: (group) => qc.setQueryData(groupKeys.detail(cn), group),
  });
}

export function useRemoveGroupMember(cn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uid: string) => groupsApi.removeMember(cn, uid),
    onSuccess: (group) => qc.setQueryData(groupKeys.detail(cn), group),
  });
}

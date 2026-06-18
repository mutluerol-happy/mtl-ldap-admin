// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { adminsApi } from "@/lib/api.tur8-additions";
import type {
  AdminCreatePayload,
  AdminListQuery,
  AdminPasswordResetPayload,
  AdminRoleAssignPayload,
  AdminUpdatePayload,
} from "@/types/admin";

export const adminKeys = {
  all: ["admins"] as const,
  lists: () => [...adminKeys.all, "list"] as const,
  list: (q: AdminListQuery) => [...adminKeys.lists(), q] as const,
  details: () => [...adminKeys.all, "detail"] as const,
  detail: (id: string) => [...adminKeys.details(), id] as const,
};

export function useAdminsList(query: AdminListQuery) {
  return useQuery({
    queryKey: adminKeys.list(query),
    queryFn: () => adminsApi.list(query),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useAdmin(id: string | undefined) {
  return useQuery({
    queryKey: id ? adminKeys.detail(id) : ["admins", "detail", "__none__"],
    queryFn: () => adminsApi.get(id as string),
    enabled: !!id,
  });
}

export function useCreateAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminCreatePayload) => adminsApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.lists() }),
  });
}

export function useUpdateAdmin(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminUpdatePayload) => adminsApi.update(id, payload),
    onSuccess: (admin) => {
      qc.setQueryData(adminKeys.detail(id), admin);
      qc.invalidateQueries({ queryKey: adminKeys.lists() });
    },
  });
}

export function useDeleteAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminsApi.delete(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: adminKeys.detail(id) });
      qc.invalidateQueries({ queryKey: adminKeys.lists() });
    },
  });
}

export function useAssignAdminRole(adminId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminRoleAssignPayload) =>
      adminsApi.assignRole(adminId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.detail(adminId) });
      qc.invalidateQueries({ queryKey: adminKeys.lists() });
    },
  });
}

export function useRevokeAdminRole(adminId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => adminsApi.revokeRole(adminId, roleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.detail(adminId) });
      qc.invalidateQueries({ queryKey: adminKeys.lists() });
    },
  });
}

export function useResetAdminPassword(adminId: string) {
  return useMutation({
    mutationFn: (payload: AdminPasswordResetPayload) =>
      adminsApi.resetPassword(adminId, payload),
  });
}

export function useResetAdminMfa(adminId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminsApi.resetMfa(adminId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: adminKeys.detail(adminId) }),
  });
}

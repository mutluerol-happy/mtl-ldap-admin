// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useQuery } from "@tanstack/react-query";
import { permissionsApi, rolesApi } from "@/lib/api.tur8-additions";

export const roleKeys = {
  all: ["roles"] as const,
  list: () => [...roleKeys.all, "list"] as const,
  detail: (name: string) => [...roleKeys.all, "detail", name] as const,
};

export const permissionKeys = {
  all: ["permissions"] as const,
  list: () => [...permissionKeys.all, "list"] as const,
  grouped: () => [...permissionKeys.all, "grouped"] as const,
};

export function useRolesList() {
  return useQuery({
    queryKey: roleKeys.list(),
    queryFn: () => rolesApi.list(),
    staleTime: 5 * 60_000, // 5 dakika — roller seyrek değişir
  });
}

export function useRole(name: string | undefined) {
  return useQuery({
    queryKey: name ? roleKeys.detail(name) : ["roles", "detail", "__none__"],
    queryFn: () => rolesApi.get(name as string),
    enabled: !!name,
    staleTime: 60_000,
  });
}

export function usePermissionsList() {
  return useQuery({
    queryKey: permissionKeys.list(),
    queryFn: () => permissionsApi.list(),
    staleTime: 10 * 60_000,
  });
}

export function usePermissionsGrouped() {
  return useQuery({
    queryKey: permissionKeys.grouped(),
    queryFn: () => permissionsApi.grouped(),
    staleTime: 10 * 60_000,
  });
}

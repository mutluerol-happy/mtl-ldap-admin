// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { usersApi } from "@/lib/api.tur7-additions";
import type {
  UserCreatePayload,
  UserListQuery,
  UserPasswordResetPayload,
  UserUpdatePayload,
} from "@/types/user";

export const userKeys = {
  all: ["users"] as const,
  lists: () => [...userKeys.all, "list"] as const,
  list: (q: UserListQuery) => [...userKeys.lists(), q] as const,
  details: () => [...userKeys.all, "detail"] as const,
  detail: (uid: string) => [...userKeys.details(), uid] as const,
  groups: (uid: string) => [...userKeys.detail(uid), "groups"] as const,
};

export function useUsersList(query: UserListQuery) {
  return useQuery({
    queryKey: userKeys.list(query),
    queryFn: () => usersApi.list(query),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useUser(uid: string | undefined) {
  return useQuery({
    queryKey: uid ? userKeys.detail(uid) : ["users", "detail", "__none__"],
    queryFn: () => usersApi.get(uid as string),
    enabled: !!uid,
  });
}

export function useUserGroups(uid: string | undefined) {
  return useQuery({
    queryKey: uid ? userKeys.groups(uid) : ["users", "groups", "__none__"],
    queryFn: () => usersApi.groups(uid as string),
    enabled: !!uid,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UserCreatePayload) => usersApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.lists() }),
  });
}

export function useUpdateUser(uid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UserUpdatePayload) => usersApi.update(uid, payload),
    onSuccess: (user) => {
      qc.setQueryData(userKeys.detail(uid), user);
      qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uid: string) => usersApi.delete(uid),
    onSuccess: (_, uid) => {
      qc.removeQueries({ queryKey: userKeys.detail(uid) });
      qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useActivateUser(uid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => usersApi.activate(uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.detail(uid) });
      qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useDeactivateUser(uid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => usersApi.deactivate(uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.detail(uid) });
      qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useLockUser(uid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => usersApi.lock(uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.detail(uid) });
      qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useUnlockUser(uid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => usersApi.unlock(uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.detail(uid) });
      qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useResetUserPassword(uid: string) {
  return useMutation({
    mutationFn: (payload: UserPasswordResetPayload) =>
      usersApi.resetPassword(uid, payload),
  });
}

export function useResetUserMfa(uid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => usersApi.resetMfa(uid),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.detail(uid) }),
  });
}

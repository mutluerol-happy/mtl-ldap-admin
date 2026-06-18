// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Upload, Users as UsersIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { DataTable, DataTableColumn } from "@/components/data/DataTable";
import { Pagination } from "@/components/data/Pagination";
import { SearchBar } from "@/components/data/SearchBar";
import { EmptyState } from "@/components/data/EmptyState";
import { UserStatusBadge } from "@/components/user/UserStatusBadge";
import { UserActionMenu } from "@/components/user/UserActionMenu";
import { ConfirmDialog } from "@/components/dialog/ConfirmDialog";
import { Modal } from "@/components/dialog/Modal";
import { usePasswordPolicy, policyHintText } from "@/hooks/usePasswordPolicy";

import { useUsersList, useDeleteUser, userKeys } from "@/hooks/useUsers";
import { usersApi } from "@/lib/api.tur7-additions";
import type { User, UserListQuery } from "@/types/user";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function UsersList() {
  const { t } = useTranslation(["users", "common"]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  const query: UserListQuery = useMemo(
    () => ({
      page: Number(params.get("page") ?? 1),
      page_size: Number(params.get("page_size") ?? 25),
      search: params.get("q") ?? undefined,
    }),
    [params],
  );

  const setParam = (k: string, v: string | number | undefined) => {
    const next = new URLSearchParams(params);
    if (v === undefined || v === null || v === "") next.delete(k);
    else next.set(k, String(v));
    if (k !== "page") next.set("page", "1");
    setParams(next, { replace: true });
  };

  const { data, isLoading, isError, error } = useUsersList(query);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: userKeys.lists() });
  };
  const activateMut = useMutation({
    mutationFn: (uid: string) => usersApi.activate(uid),
    onSuccess: invalidate,
  });
  const deactivateMut = useMutation({
    mutationFn: (uid: string) => usersApi.deactivate(uid),
    onSuccess: invalidate,
  });
  const lockMut = useMutation({
    mutationFn: (uid: string) => usersApi.lock(uid),
    onSuccess: invalidate,
  });
  const unlockMut = useMutation({
    mutationFn: (uid: string) => usersApi.unlock(uid),
    onSuccess: invalidate,
  });
  const resetMfaMut = useMutation({
    mutationFn: (uid: string) => usersApi.resetMfa(uid),
    onSuccess: invalidate,
  });
  const deleteUser = useDeleteUser();

  const policy = usePasswordPolicy();
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetNewPw, setResetNewPw] = useState("");
  const [resetMustChange, setResetMustChange] = useState(true);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);

  const columns: DataTableColumn<User>[] = [
    {
      key: "uid",
      header: t("columns.uid"),
      cell: (u) => (
        <Link
          to={`/users/${encodeURIComponent(u.uid)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-sm text-primary hover:underline"
        >
          {u.uid}
        </Link>
      ),
    },
    {
      key: "cn",
      header: t("columns.name"),
      cell: (u) => (
        <div className="min-w-0">
          <div className="truncate text-fg">{u.cn || "—"}</div>
          {u.title && (
            <div className="truncate text-xs text-fg-subtle">{u.title}</div>
          )}
        </div>
      ),
    },
    {
      key: "email",
      header: t("columns.email"),
      cell: (u) => (
        <span className="truncate text-sm text-fg-subtle">{u.email ?? "—"}</span>
      ),
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: (u) => <UserStatusBadge user={u} />,
    },
    {
      key: "mfa",
      header: t("columns.mfa"),
      align: "center",
      cell: (u) =>
        u.mfa_enabled ? (
          <span className="text-emerald-600">●</span>
        ) : (
          <span className="text-fg-subtle">○</span>
        ),
    },
    {
      key: "last_login",
      header: t("columns.lastLogin"),
      cell: (u) => (
        <span className="text-sm text-fg-subtle">
          {u.last_login_at
            ? new Date(u.last_login_at).toLocaleString("tr-TR")
            : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "48px",
      align: "right",
      cell: (u) => (
        <UserActionMenu
          user={u}
          onResetPassword={() => {
            setResetTarget(u);
            setResetNewPw("");
            setResetMustChange(true);
            setResetError(null);
          }}
          onActivate={() => activateMut.mutate(u.uid)}
          onDeactivate={() => deactivateMut.mutate(u.uid)}
          onLock={() => lockMut.mutate(u.uid)}
          onUnlock={() => unlockMut.mutate(u.uid)}
          onResetMfa={() => resetMfaMut.mutate(u.uid)}
          onDelete={() => setConfirmDelete(u)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">{t("title")}</h1>
          <p className="text-sm text-fg-subtle">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/users/bulk-import")}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
          >
            <Upload className="h-4 w-4" />
            {t("bulkImport")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/users/new")}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t("newUser")}
          </button>
        </div>
      </div>

      <SearchBar
        value={query.search ?? ""}
        onChange={(v) => setParam("q", v || undefined)}
        placeholder={t("search.placeholder")}
      />

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Kullanıcılar yüklenemedi: {extractBackendError(error)}
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey={(u) => u.uid}
        loading={isLoading}
        onRowClick={(u) => navigate(`/users/${encodeURIComponent(u.uid)}`)}
        density="compact"
        emptyState={
          <EmptyState
            icon={UsersIcon}
            title={t("empty.title")}
            description={t("empty.description")}
            action={
              <button
                type="button"
                onClick={() => navigate("/users/new")}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" /> {t("newUser")}
              </button>
            }
          />
        }
      />

      {data && data.total > 0 && (
        <Pagination
          page={query.page ?? 1}
          pageSize={query.page_size ?? 25}
          total={data.total}
          onPageChange={(p) => setParam("page", p)}
          onPageSizeChange={(s) => {
            setParam("page_size", s);
            setParam("page", 1);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return;
          await deleteUser.mutateAsync(confirmDelete.uid);
        }}
        title={t("delete.title")}
        description={
          confirmDelete && (
            <span>
              <span className="font-mono text-fg">{confirmDelete.uid}</span>{" "}
              kullanıcısı kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </span>
          )
        }
        confirmLabel={t("delete.confirm")}
        variant="danger"
        confirmText={confirmDelete?.uid}
      />

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={
          resetTarget ? t("reset.title", { uid: resetTarget.uid }) : t("reset.titleGeneric")
        }
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setResetTarget(null)}
              disabled={resetPending}
              className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
            >
              {t("common:cancel")}
            </button>
            <button
              type="button"
              disabled={resetPending || !resetTarget || resetNewPw.length < (policy?.min_length ?? 8)}
              onClick={async () => {
                if (!resetTarget) return;
                try {
                  setResetPending(true);
                  setResetError(null);
                  await usersApi.resetPassword(resetTarget.uid, {
                    new_password: resetNewPw,
                    must_change: resetMustChange,
                  });
                  setResetTarget(null);
                } catch (e) {
                  setResetError(extractBackendError(e));
                } finally {
                  setResetPending(false);
                }
              }}
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {resetPending ? t("reset.submitting") : t("reset.submit")}
            </button>
          </>
        }
      >
        {resetError && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {resetError}
          </div>
        )}
        <p className="mb-3 text-sm text-fg-subtle">
          {`Yeni parola en az ${policy.min_length} karakter olmalı; ${policyHintText(policy)}`}
          uygulanır.
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-fg-subtle">
            {t("reset.newPasswordLabel")}
          </span>
          <input
            type="password"
            value={resetNewPw}
            onChange={(e) => setResetNewPw(e.target.value)}
            autoComplete="new-password"
            className="block w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={resetMustChange}
            onChange={(e) => setResetMustChange(e.target.checked)}
            className="h-4 w-4"
          />
          {t("form.mustChangeOnFirstLogin")}
        </label>
      </Modal>
    </div>
  );
}

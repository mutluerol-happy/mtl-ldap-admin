// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Users2 } from "lucide-react";

import { DataTable, DataTableColumn } from "@/components/data/DataTable";
import { Pagination } from "@/components/data/Pagination";
import { SearchBar } from "@/components/data/SearchBar";
import { EmptyState } from "@/components/data/EmptyState";
import { Modal } from "@/components/dialog/Modal";
import { ConfirmDialog } from "@/components/dialog/ConfirmDialog";
import { GroupForm } from "@/components/group/GroupForm";

import {
  useGroupsList,
  useCreateGroup,
  useDeleteGroup,
} from "@/hooks/useGroups";
import type { Group, GroupCreatePayload, GroupListQuery } from "@/types/group";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function GroupsList() {
  const { t } = useTranslation(["groups", "common"]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const query: GroupListQuery = useMemo(
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

  const { data, isLoading, isError, error } = useGroupsList(query);
  const createGroup = useCreateGroup();
  const deleteGroup = useDeleteGroup();

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Group | null>(null);

  const columns: DataTableColumn<Group>[] = [
    {
      key: "cn",
      header: t("columns.cn"),
      cell: (g) => (
        <Link
          to={`/groups/${encodeURIComponent(g.cn)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-sm text-primary hover:underline"
        >
          {g.cn}
        </Link>
      ),
    },
    {
      key: "description",
      header: t("columns.description"),
      cell: (g) => (
        <span className="truncate text-sm text-fg-subtle">
          {g.description ?? "—"}
        </span>
      ),
    },
    {
      key: "type",
      header: t("columns.type"),
      cell: (g) => (
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-fg">
          {g.group_type}
        </span>
      ),
    },
    {
      key: "members",
      header: t("columns.members"),
      align: "right",
      cell: (g) => (
        <span className="font-mono text-sm text-fg">
          {(g.member_count ?? 0).toLocaleString("tr-TR")}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "48px",
      align: "right",
      cell: (g) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(g);
          }}
          className="text-xs text-destructive hover:underline"
        >
          {t("delete.confirm")}
        </button>
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
        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t("newGroup")}
        </button>
      </div>

      <SearchBar
        value={query.search ?? ""}
        onChange={(v) => setParam("q", v || undefined)}
        placeholder={t("search.placeholder")}
      />

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Gruplar yüklenemedi: {extractBackendError(error)}
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey={(g) => g.cn}
        loading={isLoading}
        onRowClick={(g) => navigate(`/groups/${encodeURIComponent(g.cn)}`)}
        density="compact"
        emptyState={
          <EmptyState
            icon={Users2}
            title="Henüz grup yok"
            description="İlk grubu oluşturarak başlayın."
            action={
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" /> {t("newGroup")}
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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("newGroupDialog")}
        size="lg"
      >
        {createError && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {createError}
          </div>
        )}
        <GroupForm
          mode="create"
          submitting={createGroup.isPending}
          onCancel={() => setCreateOpen(false)}
          onSubmit={async (values) => {
            setCreateError(null);
            try {
              const g = await createGroup.mutateAsync(
                values as GroupCreatePayload,
              );
              setCreateOpen(false);
              navigate(`/groups/${encodeURIComponent(g.cn)}`);
            } catch (e) {
              setCreateError(extractBackendError(e));
            }
          }}
        />
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return;
          await deleteGroup.mutateAsync(confirmDelete.cn);
        }}
        title="Grubu sil"
        description={
          confirmDelete && (
            <span>
              <span className="font-mono text-fg">{confirmDelete.cn}</span>{" "}
              kalıcı olarak silinecek.
              {confirmDelete.member_count > 0 && (
                <> <strong>{confirmDelete.member_count}</strong> üye ataması kaldırılacak.</>
              )}
            </span>
          )
        }
        confirmLabel={t("delete.confirm")}
        variant="danger"
        confirmText={confirmDelete?.cn}
      />
    </div>
  );
}

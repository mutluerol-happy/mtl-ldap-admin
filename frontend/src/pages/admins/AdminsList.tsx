// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, ShieldCheck } from "lucide-react";

import { DataTable, DataTableColumn } from "@/components/data/DataTable";
import { Pagination } from "@/components/data/Pagination";
import { SearchBar } from "@/components/data/SearchBar";
import { EmptyState } from "@/components/data/EmptyState";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { RoleBadges } from "@/components/admin/RoleBadges";

import { useAdminsList } from "@/hooks/useAdmins";
import type { Admin, AdminListQuery } from "@/types/admin";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function AdminsList() {
  const { t } = useTranslation(["admins", "common"]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const query: AdminListQuery = useMemo(() => {
    const isActive = params.get("is_active");
    return {
      page: Number(params.get("page") ?? 1),
      page_size: Number(params.get("page_size") ?? 25),
      search: params.get("q") ?? undefined,
      is_active:
        isActive === "true" ? true : isActive === "false" ? false : undefined,
    };
  }, [params]);

  const setParam = (k: string, v: string | number | undefined) => {
    const next = new URLSearchParams(params);
    if (v === undefined || v === null || v === "") next.delete(k);
    else next.set(k, String(v));
    if (k !== "page") next.set("page", "1");
    setParams(next, { replace: true });
  };

  const { data, isLoading, isError, error } = useAdminsList(query);

  const columns: DataTableColumn<Admin>[] = [
    {
      key: "username",
      header: t("columns.user"),
      cell: (a) => (
        <Link
          to={`/admins/${encodeURIComponent(a.id)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-sm text-primary hover:underline"
        >
          {a.username}
        </Link>
      ),
    },
    {
      key: "display_name",
      header: t("columns.name"),
      cell: (a) => (
        <div className="min-w-0">
          <div className="truncate text-fg">{a.display_name}</div>
          <div className="truncate text-xs text-fg-subtle">{a.email}</div>
        </div>
      ),
    },
    {
      key: "roles",
      header: t("columns.roles"),
      cell: (a) => <RoleBadges roles={a.roles} linkable size="xs" />,
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: (a) => <AdminStatusBadge admin={a} />,
    },
    {
      key: "mfa",
      header: t("columns.mfa"),
      align: "center",
      cell: (a) =>
        a.mfa_enabled ? (
          <span className="text-emerald-600">●</span>
        ) : (
          <span className="text-fg-subtle">○</span>
        ),
    },
    {
      key: "last_login",
      header: t("columns.lastLogin"),
      cell: (a) => (
        <span className="text-sm text-fg-subtle">
          {a.last_login_at
            ? new Date(a.last_login_at).toLocaleString("tr-TR")
            : "—"}
        </span>
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
          onClick={() => navigate("/admins/new")}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t("newAdmin")}
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchBar
          value={query.search ?? ""}
          onChange={(v) => setParam("q", v || undefined)}
          placeholder={t("search.placeholder")}
        />
        <select
          value={
            query.is_active === undefined ? "" : String(query.is_active)
          }
          onChange={(e) =>
            setParam("is_active", e.target.value || undefined)
          }
          className="h-9 rounded-md border border-border bg-bg px-3 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">{t("filters.all")}</option>
          <option value="true">{t("filters.onlyActive")}</option>
          <option value="false">{t("filters.onlyDisabled")}</option>
        </select>
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Adminler yüklenemedi: {extractBackendError(error)}
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey={(a) => a.id}
        loading={isLoading}
        onRowClick={(a) => navigate(`/admins/${encodeURIComponent(a.id)}`)}
        density="compact"
        emptyState={
          <EmptyState
            icon={ShieldCheck}
            title={t("empty.title")}
            description={t("empty.description")}
            action={
              <button
                type="button"
                onClick={() => navigate("/admins/new")}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" /> {t("newAdmin")}
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
    </div>
  );
}

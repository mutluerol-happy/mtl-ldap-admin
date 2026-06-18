// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw, ScrollText } from "lucide-react";

import { DataTable, DataTableColumn } from "@/components/data/DataTable";
import { Pagination } from "@/components/data/Pagination";
import { EmptyState } from "@/components/data/EmptyState";
import { SeverityBadge } from "@/components/audit/SeverityBadge";
import { AuditSummaryCards } from "@/components/audit/AuditSummaryCards";
import { AuditFilters } from "@/components/audit/AuditFilters";

import { useAuditEvents, useAuditSummary } from "@/hooks/useAudit";
import type { AuditEventQuery, EventLog } from "@/types/audit";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

const PERSIST_KEYS: (keyof AuditEventQuery)[] = [
  "page",
  "page_size",
  "category",
  "event_code",
  "severity",
  "actor_id",
  "actor_display",
  "target_id",
  "ip_address",
  "server_node",
  "search",
  "date_from",
  "date_to",
];

export default function AuditEvents() {
  const { t } = useTranslation("audit");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const query: AuditEventQuery = useMemo(() => {
    const q: AuditEventQuery = {
      page: Number(params.get("page") ?? 1),
      page_size: Number(params.get("page_size") ?? 25),
    };
    for (const k of PERSIST_KEYS) {
      if (k === "page" || k === "page_size") continue;
      const v = params.get(k);
      if (v) (q as any)[k] = v;
    }
    return q;
  }, [params]);

  const updateQuery = useCallback(
    (next: Partial<AuditEventQuery>) => {
      const updated = new URLSearchParams(params);
      let resetPage = false;
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === null || v === "") {
          updated.delete(k);
        } else {
          updated.set(k, String(v));
        }
        if (k !== "page" && k !== "page_size") resetPage = true;
      }
      if (resetPage) updated.set("page", "1");
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  const reset = useCallback(() => {
    setParams({}, { replace: true });
  }, [setParams]);

  const { data: summary, isLoading: summaryLoading } = useAuditSummary(24);
  const {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useAuditEvents(query);

  const columns: DataTableColumn<EventLog>[] = [
    {
      key: "occurred_at",
      header: t("columns.time"),
      cell: (e) => (
        <div className="font-mono text-xs leading-tight">
          <div className="text-fg">
            {new Date(e.occurred_at).toLocaleString("tr-TR")}
          </div>
        </div>
      ),
    },
    {
      key: "severity",
      header: t("columns.severity"),
      cell: (e) => <SeverityBadge severity={e.severity} />,
    },
    {
      key: "category",
      header: t("columns.category"),
      cell: (e) => (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-fg">
          {e.category}
        </span>
      ),
    },
    {
      key: "server_node",
      header: t("columns.serverNode"),
      cell: (e) =>
        e.server_node ? (
          <span className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle">
            {e.server_node}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "event_code",
      header: t("columns.eventCode"),
      cell: (e) => (
        <span className="font-mono text-xs text-fg">{e.event_code}</span>
      ),
    },
    {
      key: "actor",
      header: t("columns.actor"),
      cell: (e) => (
        <div className="min-w-0 text-xs">
          <div className="truncate text-fg">
            {e.actor_display ?? e.actor_id ?? (
              <span className="italic text-fg-subtle">—</span>
            )}
          </div>
          {e.actor_type && (
            <div className="text-fg-subtle">{e.actor_type}</div>
          )}
        </div>
      ),
    },
    {
      key: "target",
      header: t("columns.target"),
      cell: (e) => (
        <div className="min-w-0 text-xs">
          <div className="truncate text-fg">
            {e.target_display ?? e.target_id ?? (
              <span className="italic text-fg-subtle">—</span>
            )}
          </div>
          {e.target_type && (
            <div className="text-fg-subtle">{e.target_type}</div>
          )}
        </div>
      ),
    },
    {
      key: "ip",
      header: t("columns.ip"),
      cell: (e) =>
        e.ip_address ? (
          <span className="font-mono text-[11px] text-fg-subtle">
            {e.ip_address}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">{t("title")}</h1>
          <p className="text-sm text-fg-subtle">
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
          {t("refresh")}
        </button>
      </div>

      <AuditSummaryCards data={summary} isLoading={summaryLoading} />

      <AuditFilters query={query} onChange={updateQuery} onReset={reset} />

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Audit kayıtları yüklenemedi: {extractBackendError(error)}
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey={(e) => e.id}
        loading={isLoading}
        onRowClick={(e) =>
          navigate(`/audit/${encodeURIComponent(e.id)}`)
        }
        density="compact"
        emptyState={
          <EmptyState
            icon={ScrollText}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        }
      />

      {data && data.total > 0 && (
        <Pagination
          page={query.page ?? 1}
          pageSize={query.page_size ?? 25}
          total={data.total}
          onPageChange={(p) => updateQuery({ page: p })}
          onPageSizeChange={(s) => updateQuery({ page_size: s, page: 1 })}
        />
      )}
    </div>
  );
}

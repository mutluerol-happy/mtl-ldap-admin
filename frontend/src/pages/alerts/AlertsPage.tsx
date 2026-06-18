// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Power,
  RefreshCw,
  Siren,
} from "lucide-react";

import { DataTable, DataTableColumn } from "@/components/data/DataTable";
import { Pagination } from "@/components/data/Pagination";
import { EmptyState } from "@/components/data/EmptyState";
import { SeverityBadge } from "@/components/audit/SeverityBadge";
import { AlertStatusBadge } from "@/components/alerts/AlertStatusBadge";
import { RuleEditDialog } from "@/components/alerts/RuleEditDialog";
import {
  AckAlertDialog,
  ResolveAlertDialog,
} from "@/components/alerts/AckResolveDialog";

import {
  useAlertEvents,
  useAlertRules,
  useUpdateAlertRule,
} from "@/hooks/useAlerts";
import type { AlertEvent, AlertEventQuery, AlertRule } from "@/types/alert";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

const STATUS_OPTIONS = [
  { value: "", label: "filters.allStatus" },
  { value: "open", label: "status.open" },
  { value: "acknowledged", label: "status.acknowledged" },
  { value: "resolved", label: "status.resolved" },
  { value: "suppressed", label: "status.suppressed" },
];

const SEVERITY_OPTIONS = [
  { value: "", label: "filters.allSeverity" },
  { value: "CRITICAL", label: "CRITICAL" },
  { value: "ERROR", label: "ERROR" },
  { value: "WARNING", label: "WARNING" },
  { value: "NOTICE", label: "NOTICE" },
  { value: "INFO", label: "INFO" },
];

export default function AlertsPage() {
  const { t } = useTranslation("alerts");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rulesExpanded, setRulesExpanded] = useState(true);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [ackTarget, setAckTarget] = useState<AlertEvent | null>(null);
  const [resolveTarget, setResolveTarget] = useState<AlertEvent | null>(null);

  const query: AlertEventQuery = useMemo(
    () => ({
      page: Number(params.get("page") ?? 1),
      page_size: Number(params.get("page_size") ?? 25),
      status: params.get("status") || undefined,
      severity: params.get("severity") || undefined,
      rule_id: params.get("rule_id") || undefined,
    }),
    [params],
  );

  const setParam = (k: string, v: string | number | undefined) => {
    const next = new URLSearchParams(params);
    if (v === undefined || v === null || v === "") next.delete(k);
    else next.set(k, String(v));
    if (k !== "page" && k !== "page_size") next.set("page", "1");
    setParams(next, { replace: true });
  };

  const { data: rules, isLoading: rulesLoading, refetch: refetchRules } =
    useAlertRules();
  const {
    data: events,
    isLoading: eventsLoading,
    isError,
    error,
    isFetching,
    refetch: refetchEvents,
  } = useAlertEvents(query);

  // Quick toggle (kural sayfası açmadan enable/disable)
  const quickToggleMut = useUpdateAlertRule("__placeholder__");
  // Not: hook tek bir ruleId'ye bağlı. Çoklu için ayrı çağrı gerek. Workaround:
  // Inline çağrı için bir alt component daha temiz olurdu, ama burada doğrudan
  // alertsApi'yi kullanırız. (Aslında inline minimum kod için ayrı bir hook
  // çağrısı yapıyoruz — yakındaki <RuleRow> içinde değil.)

  const eventColumns: DataTableColumn<AlertEvent>[] = [
    {
      key: "triggered_at",
      header: t("columns.time"),
      cell: (e) => (
        <span className="font-mono text-xs text-fg">
          {new Date(e.triggered_at).toLocaleString("tr-TR")}
        </span>
      ),
    },
    {
      key: "severity",
      header: t("columns.severity"),
      cell: (e) => <SeverityBadge severity={e.severity} />,
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: (e) => <AlertStatusBadge status={e.status} />,
    },
    {
      key: "summary",
      header: t("columns.summary"),
      cell: (e) => (
        <div className="min-w-0 max-w-md">
          <div className="truncate text-sm text-fg">{e.summary}</div>
        </div>
      ),
    },
    {
      key: "count",
      header: t("columns.event"),
      align: "right",
      cell: (e) => (
        <span className="font-mono text-xs text-fg-subtle">
          ×{e.event_count}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (e) => (
        <div
          className="flex justify-end gap-1"
          onClick={(ev) => ev.stopPropagation()}
        >
          {e.status === "open" && (
            <button
              type="button"
              onClick={() => setAckTarget(e)}
              className="rounded-md border border-border bg-bg px-2 py-1 text-[11px] text-fg hover:bg-muted"
            >
              Onayla
            </button>
          )}
          {(e.status === "open" || e.status === "acknowledged") && (
            <button
              type="button"
              onClick={() => setResolveTarget(e)}
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-600 hover:bg-emerald-500/20"
            >
              {t("detail.resolveAction")}
            </button>
          )}
        </div>
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
          onClick={() => {
            refetchRules();
            refetchEvents();
          }}
          disabled={isFetching}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
          {t("refresh")}
        </button>
      </div>

      {/* Kurallar paneli */}
      <div className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <button
            type="button"
            onClick={() => setRulesExpanded((v) => !v)}
            className="flex items-center gap-2"
          >
            <Bell className="h-4 w-4 text-fg-subtle" />
            <h2 className="text-sm font-semibold text-fg">{t("rules.title")}</h2>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-subtle">
              {rules?.length ?? 0}
            </span>
            {rulesExpanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-fg-subtle" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" />
            )}
          </button>
          {rules && (
            <span className="text-xs text-fg-subtle">
              {t("rules.activeCount", { count: rules.filter((r) => r.enabled).length })}
            </span>
          )}
        </header>

        {rulesExpanded && (
          <div>
            {rulesLoading ? (
              <div className="px-4 py-6 text-center text-sm text-fg-subtle">
                {t("rules.loading")}
              </div>
            ) : !rules || rules.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-fg-subtle">
                {t("rules.empty")}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rules.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    onEdit={() => setEditingRule(r)}
                    onFilter={() => setParam("rule_id", r.id)}
                    selected={query.rule_id === r.id}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Event filtreleri */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <Siren className="h-4 w-4 text-fg-subtle" />
        <span className="text-sm font-medium text-fg">{t("triggeredEvents")}</span>
        <select
          value={query.status ?? ""}
          onChange={(e) => setParam("status", e.target.value || undefined)}
          className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
        <select
          value={query.severity ?? ""}
          onChange={(e) => setParam("severity", e.target.value || undefined)}
          className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {SEVERITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
        {query.rule_id && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
            Kural filtresi aktif
            <button
              type="button"
              onClick={() => setParam("rule_id", undefined)}
              className="rounded hover:bg-primary/20"
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t("rules.eventsLoadError")}: {extractBackendError(error)}
        </div>
      )}

      <DataTable
        columns={eventColumns}
        data={events?.items ?? []}
        rowKey={(e) => e.id}
        loading={eventsLoading}
        onRowClick={(e) =>
          navigate(`/alerts/${encodeURIComponent(e.id)}`)
        }
        density="compact"
        emptyState={
          <EmptyState
            icon={CheckCircle2}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        }
      />

      {events && events.total > 0 && (
        <Pagination
          page={query.page ?? 1}
          pageSize={query.page_size ?? 25}
          total={events.total}
          onPageChange={(p) => setParam("page", p)}
          onPageSizeChange={(s) => setParam("page_size", s)}
        />
      )}

      <RuleEditDialog
        open={!!editingRule}
        rule={editingRule}
        onClose={() => setEditingRule(null)}
      />
      <AckAlertDialog
        open={!!ackTarget}
        eventId={ackTarget?.id ?? null}
        onClose={() => setAckTarget(null)}
      />
      <ResolveAlertDialog
        open={!!resolveTarget}
        eventId={resolveTarget?.id ?? null}
        onClose={() => setResolveTarget(null)}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
function RuleRow({
  rule,
  onEdit,
  onFilter,
  selected,
}: {
  rule: AlertRule;
  onEdit: () => void;
  onFilter: () => void;
  selected: boolean;
}) {
  const { t } = useTranslation("alerts");
  const toggleMut = useUpdateAlertRule(rule.id);
  const handleToggle = () => {
    toggleMut.mutate({ enabled: !rule.enabled });
  };

  return (
    <li
      className={[
        "flex items-start gap-3 px-4 py-2.5",
        selected ? "bg-primary/5" : "",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggleMut.isPending}
        title={rule.enabled ? t("common:userActions.disable") : t("common:userActions.activate")}
        className={[
          "mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition",
          rule.enabled
            ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
            : "bg-fg-subtle/10 text-fg-subtle hover:bg-fg-subtle/20",
        ].join(" ")}
      >
        <Power className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-fg">{rule.rule_code}</span>
          <SeverityBadge severity={rule.severity} size="xs" />
          {!rule.enabled && (
            <span className="rounded bg-fg-subtle/10 px-1.5 py-0.5 text-[10px] text-fg-subtle">
              {t("rules.disabled")}
            </span>
          )}
        </div>
        <div className="text-sm text-fg">{rule.name}</div>
        {rule.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-fg-subtle">
            {rule.description}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-fg-subtle">
          <span>
            threshold:{" "}
            <span className="font-mono text-fg">{rule.threshold_count}</span>
          </span>
          <span>
            window:{" "}
            <span className="font-mono text-fg">{rule.window_minutes}{t("rules.minShort")}</span>
          </span>
          <span>
            cooldown:{" "}
            <span className="font-mono text-fg">{rule.cooldown_minutes}{t("rules.minShort")}</span>
          </span>
          {rule.last_triggered_at && (
            <span>
              son:{" "}
              <span className="text-fg">
                {new Date(rule.last_triggered_at).toLocaleString("tr-TR")}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 gap-1">
        <button
          type="button"
          onClick={onFilter}
          className="rounded-md border border-border bg-bg px-2 py-1 text-[11px] text-fg-subtle hover:bg-muted hover:text-fg"
          title={t("rules.filterEventsTitle")}
        >
          {t("rules.filterEvents")}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg px-2 text-[11px] text-fg hover:bg-muted"
        >
          <Pencil className="h-3 w-3" />
          {t("common:actions.edit")}
        </button>
      </div>
    </li>
  );
}

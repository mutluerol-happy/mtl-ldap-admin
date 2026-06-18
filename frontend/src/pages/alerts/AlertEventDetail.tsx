// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy } from "lucide-react";

import { SeverityBadge } from "@/components/audit/SeverityBadge";
import { AlertStatusBadge } from "@/components/alerts/AlertStatusBadge";
import {
  AckAlertDialog,
  ResolveAlertDialog,
} from "@/components/alerts/AckResolveDialog";

import { useAlertEvent, useAlertRules } from "@/hooks/useAlerts";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function AlertEventDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation("alerts");
  const navigate = useNavigate();
  const [ackOpen, setAckOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  const { data, isLoading, isError, error } = useAlertEvent(id);
  const { data: rules } = useAlertRules();

  if (isLoading) {
    return <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>;
  }
  if (isError || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Alert yüklenemedi: {extractBackendError(error)}
      </div>
    );
  }

  const rule = rules?.find((r) => r.id === data.rule_id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t("detail.back")}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-fg">{data.summary}</h1>
              <SeverityBadge severity={data.severity} />
              <AlertStatusBadge status={data.status} />
            </div>
            <div className="mt-1 text-sm text-fg-subtle">
              Tetiklendi:{" "}
              <span className="font-mono">
                {new Date(data.triggered_at).toLocaleString("tr-TR")}
              </span>
              {rule && (
                <>
                  {" · Kural: "}
                  <span className="font-mono text-fg">{rule.rule_code}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {data.status === "open" && (
            <button
              type="button"
              onClick={() => setAckOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 text-sm text-amber-600 hover:bg-amber-500/20"
            >
              Onayla (acknowledge)
            </button>
          )}
          {(data.status === "open" || data.status === "acknowledged") && (
            <button
              type="button"
              onClick={() => setResolveOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-600/90"
            >
              {t("detail.resolveAction")}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Tetiklenme Bilgisi
          </h2>
          <dl className="space-y-2 text-sm">
            <DD label={t("detail.eventCount")} value={data.event_count} mono />
            <DD
              label={t("detail.windowStart")}
              value={
                data.window_start
                  ? new Date(data.window_start).toLocaleString("tr-TR")
                  : "—"
              }
              mono
            />
            <DD
              label={t("detail.windowEnd")}
              value={
                data.window_end
                  ? new Date(data.window_end).toLocaleString("tr-TR")
                  : "—"
              }
              mono
            />
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            İncelendi / Çözüldü
          </h2>
          <dl className="space-y-2 text-sm">
            <DD
              label={t("detail.acknowledged")}
              value={
                data.acknowledged_at
                  ? new Date(data.acknowledged_at).toLocaleString("tr-TR")
                  : "—"
              }
              mono
            />
            <DD
              label={t("detail.acknowledgedBy")}
              value={data.acknowledged_by ?? "—"}
              mono
            />
            <DD
              label={t("detail.resolved")}
              value={
                data.resolved_at
                  ? new Date(data.resolved_at).toLocaleString("tr-TR")
                  : "—"
              }
              mono
            />
            <DD label={t("detail.resolvedBy")} value={data.resolved_by ?? "—"} mono />
            {data.resolution_note && (
              <div className="pt-2">
                <dt className="text-xs uppercase tracking-wider text-fg-subtle">
                  {t("detail.resolveNoteLabel")}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs text-fg">
                  {data.resolution_note}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {data.matched_events && data.matched_events.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-fg">
              {t("detail.matchingEvents", { count: data.matched_events.length })}
            </h2>
          </header>
          <ul className="divide-y divide-border max-h-96 overflow-y-auto">
            {data.matched_events.map((m, idx) => (
              <li key={idx} className="px-4 py-2">
                <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-fg">
                  {JSON.stringify(m, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(data.extra_details).length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-fg">Ek Detaylar</h2>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(JSON.stringify(data.extra_details, null, 2))
                  .catch(() => undefined)
              }
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg px-2 text-xs text-fg-subtle hover:bg-muted hover:text-fg"
            >
              <Copy className="h-3 w-3" />
              Kopyala
            </button>
          </header>
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-fg">
            {JSON.stringify(data.extra_details, null, 2)}
          </pre>
        </div>
      )}

      <AckAlertDialog
        open={ackOpen}
        eventId={data.id}
        onClose={() => setAckOpen(false)}
      />
      <ResolveAlertDialog
        open={resolveOpen}
        eventId={data.id}
        onClose={() => setResolveOpen(false)}
      />
    </div>
  );
}

function DD({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1.5 last:border-0">
      <dt className="flex-shrink-0 text-xs uppercase tracking-wider text-fg-subtle">
        {label}
      </dt>
      <dd
        className={[
          "min-w-0 truncate text-right",
          mono ? "font-mono text-xs text-fg" : "text-sm text-fg",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

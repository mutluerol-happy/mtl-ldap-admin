// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Activity, ShieldAlert, ShieldCheck, AlertCircle } from "lucide-react";

import type { AuditSummary } from "@/types/audit";
import { SeverityBadge } from "./SeverityBadge";

import { useTranslation } from "react-i18next";
export function AuditSummaryCards({
  data,
  isLoading,
}: {
  data?: AuditSummary;
  isLoading: boolean;
}) {
  const { t } = useTranslation("audit");
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Toplam Olay",
      value: data.total_events.toLocaleString("tr-TR"),
      hint: `Son ${data.period_hours} saat`,
      icon: Activity,
      tone: "text-fg",
    },
    {
      label: "summary.successLogin",
      value: data.successful_login_count.toLocaleString("tr-TR"),
      hint: "ADMIN_LOGIN_SUCCESS",
      icon: ShieldCheck,
      tone: "text-emerald-600",
    },
    {
      label: "summary.failedLogin",
      value: data.failed_login_count.toLocaleString("tr-TR"),
      hint: "ADMIN_LOGIN_FAILED",
      icon: ShieldAlert,
      tone:
        data.failed_login_count > 0 ? "text-amber-600" : "text-fg-subtle",
    },
    {
      label: "summary.highImportance",
      value: (
        (data.by_severity.ERROR ?? 0) + (data.by_severity.CRITICAL ?? 0)
      ).toLocaleString("tr-TR"),
      hint: "ERROR + CRITICAL",
      icon: AlertCircle,
      tone:
        (data.by_severity.ERROR ?? 0) + (data.by_severity.CRITICAL ?? 0) > 0
          ? "text-red-600"
          : "text-fg-subtle",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={t(c.label)}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-fg-subtle">
                  {t(c.label)}
                </span>
                <Icon className={`h-4 w-4 ${c.tone}`} />
              </div>
              <div className={`mt-1 text-2xl font-semibold ${c.tone}`}>
                {c.value}
              </div>
              <div className="text-[11px] text-fg-subtle">{c.hint}</div>
            </div>
          );
        })}
      </div>

      {/* Severity dağılım rozetleri */}
      {Object.keys(data.by_severity).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
          <span className="text-xs uppercase tracking-wider text-fg-subtle">
            {t("summary.severityDistribution")}
          </span>
          {(["CRITICAL", "ERROR", "WARNING", "NOTICE", "INFO"] as const).map(
            (sev) => {
              const count = data.by_severity[sev] ?? 0;
              if (count === 0) return null;
              return (
                <span
                  key={sev}
                  className="inline-flex items-center gap-1.5"
                >
                  <SeverityBadge severity={sev} size="xs" />
                  <span className="font-mono text-xs text-fg">{count}</span>
                </span>
              );
            },
          )}
        </div>
      )}

      {/* Top event codes (eğer varsa) */}
      {data.top_event_codes && data.top_event_codes.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-fg-subtle">
            {t("summary.topEvents", { count: data.top_event_codes.length })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.top_event_codes.slice(0, 8).map((item, idx) => {
              const code = String(item.event_code ?? item.code ?? "—");
              const count = Number(item.count ?? 0);
              return (
                <span
                  key={`${code}-${idx}`}
                  className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-xs"
                >
                  <span className="font-mono text-fg">{code}</span>
                  <span className="text-fg-subtle">×{count}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy } from "lucide-react";

import { SeverityBadge } from "@/components/audit/SeverityBadge";
import { useAuditEvent } from "@/hooks/useAudit";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function AuditEventDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation("audit");
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useAuditEvent(id);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Kayıt yüklenemedi: {extractBackendError(error)}
      </div>
    );
  }

  const detailJson = JSON.stringify(data.details, null, 2);
  const copyId = () => navigator.clipboard?.writeText(data.id).catch(() => undefined);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t("detail.back")}
          className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold text-fg">
              {data.event_code}
            </h1>
            <SeverityBadge severity={data.severity} />
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg">
              {data.category}
            </span>
          </div>
          <div className="mt-1 text-sm text-fg-subtle">
            {new Date(data.occurred_at).toLocaleString("tr-TR")}
            {data.server_node && (
              <span className="ml-3">
                <span className="text-fg-subtle">node:</span>{" "}
                <span className="font-mono">{data.server_node}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Aktör (Eylemi Yapan)
          </h2>
          <dl className="space-y-2 text-sm">
            <DD label={t("detail.actor.type")} value={data.actor_type ?? "—"} mono />
            <DD label={t("detail.actor.id")} value={data.actor_id ?? "—"} mono />
            <DD
              label={t("detail.actor.displayName")}
              value={data.actor_display ?? "—"}
            />
            <DD label={t("detail.actor.ip")} value={data.ip_address ?? "—"} mono />
            <DD label={t("detail.actor.userAgent")} value={data.user_agent ?? "—"} />
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Hedef (Etkilenen Nesne)
          </h2>
          <dl className="space-y-2 text-sm">
            <DD label={t("detail.target.type")} value={data.target_type ?? "—"} mono />
            <DD label={t("detail.target.id")} value={data.target_id ?? "—"} mono />
            <DD
              label={t("detail.target.displayName")}
              value={data.target_display ?? "—"}
            />
            <DD
              label={t("detail.target.requestId")}
              value={data.request_id ?? "—"}
              mono
            />
          </dl>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-fg">Detaylar (JSON)</h2>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard?.writeText(detailJson).catch(() => undefined)
            }
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg px-2 text-xs text-fg-subtle hover:bg-muted hover:text-fg"
            title={t("detail.copy")}
          >
            <Copy className="h-3 w-3" />
            Kopyala
          </button>
        </header>
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-fg">
          {Object.keys(data.details).length > 0
            ? detailJson
            : "(boş — bu event için ek detay yok)"}
        </pre>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2">
        <span className="text-xs text-fg-subtle">
          Event ID:{" "}
          <span className="font-mono text-fg">{data.id}</span>
        </span>
        <button
          type="button"
          onClick={copyId}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg px-2 text-xs text-fg-subtle hover:bg-muted hover:text-fg"
        >
          <Copy className="h-3 w-3" />
          Kopyala
        </button>
      </div>
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

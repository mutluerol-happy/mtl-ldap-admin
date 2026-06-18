// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { useBulkJob } from "@/hooks/useBulkJob";
import type { BulkJobStatus } from "@/types/common";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

const STATUS_META: Record<
  string,
  { label: string; icon: typeof CheckCircle2; tone: string }
> = {
  pending: { label: "Beklemede", icon: Clock, tone: "text-fg-subtle" },
  running: { label: "job.status.running", icon: Loader2, tone: "text-primary" },
  completed: {
    label: "job.status.completed",
    icon: CheckCircle2,
    tone: "text-emerald-600",
  },
  failed: { label: "job.status.failed", icon: XCircle, tone: "text-destructive" },
  partial: {
    label: "job.status.partial",
    icon: AlertTriangle,
    tone: "text-amber-600",
  },
  cancelled: { label: "job.status.cancelled", icon: XCircle, tone: "text-fg-subtle" },
};

function fmt(s: string | null): string {
  return s ? new Date(s).toLocaleString("tr-TR") : "—";
}

export default function BulkJobStatusPage() {
  const { t } = useTranslation("bulk");
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: job, isLoading, isError, error } = useBulkJob(id);

  if (isLoading) {
    return <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>;
  }
  if (isError || !job) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t("job.loadFailed")}: {extractBackendError(error)}
      </div>
    );
  }

  const status = (job.status as BulkJobStatus) ?? "pending";
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  const Icon = meta.icon;
  const animate = status === "running" ? "animate-spin" : "";
  const pct =
    job.total_records > 0
      ? Math.round((job.processed_records / job.total_records) * 100)
      : 0;
  const isTerminal =
    status === "completed" ||
    status === "failed" ||
    status === "partial" ||
    status === "cancelled";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Geri"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-xl font-semibold text-fg">{t("job.title")}</h1>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`flex items-center gap-2 ${meta.tone}`}>
              <Icon className={`h-5 w-5 ${animate}`} />
              <span className="text-base font-semibold">{t(meta.label)}</span>
            </div>
            <div className="mt-1 font-mono text-xs text-fg-subtle">{job.id}</div>
            {job.source_filename && (
              <div className="mt-1 text-sm text-fg-subtle">
                Kaynak: <span className="font-mono">{job.source_filename}</span>
                {job.source_format && ` · ${job.source_format}`}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs text-fg-subtle">
              <span>
                {job.processed_records.toLocaleString("tr-TR")} /{" "}
                {job.total_records.toLocaleString()} {t("job.records", { count: job.total_records })}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat
              label={t("job.successCount")}
              value={job.successful_records}
              tone="text-emerald-600"
            />
            <Stat
              label={t("job.failedCount")}
              value={job.failed_records}
              tone="text-destructive"
            />
            <Stat
              label="Toplam"
              value={job.total_records}
              tone="text-fg"
            />
          </div>

          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <DD label={t("job.queuedAt")} value={fmt(job.queued_at)} />
            <DD label={t("job.startedAt")} value={fmt(job.started_at)} />
            <DD label={t("job.completedAt")} value={fmt(job.completed_at)} />
          </dl>
        </div>
      </div>

      {job.error_log && job.error_log.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold text-fg">{t("job.errorLog")}</h2>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-subtle">
                {job.error_log.length}
              </span>
            </div>
          </header>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {job.error_log.map((e, idx) => (
              <li key={idx} className="px-4 py-2">
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-fg-subtle">
                  {JSON.stringify(e, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isTerminal && (
        <p className="text-center text-xs text-fg-subtle">
          Bu sayfa otomatik olarak güncelleniyor (2 saniyede bir).
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  const { t } = useTranslation("bulk");
  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className={`font-mono text-xl font-semibold ${tone}`}>
        {value.toLocaleString("tr-TR")}
      </div>
      <div className="text-xs text-fg-subtle">{label}</div>
    </div>
  );
}

function DD({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-fg-subtle">
        {label}
      </dt>
      <dd className="text-sm text-fg">{value}</dd>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import {
  CheckCircle2,
  Database,
  FolderTree,
  GitCompareArrows,
  Play,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { DiscrepancyTypeBadge } from "@/components/sync/DiscrepancyTypeBadge";
import { ResolveDiscrepancyDialog } from "@/components/sync/ResolveDiscrepancyDialog";

import { useSyncStatus, useTriggerSyncScan } from "@/hooks/useSync";
import type { SyncDiscrepancy } from "@/types/sync";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function SyncPage() {
  const { data, isLoading, isError, error, isFetching, refetch } = useSyncStatus();
  const { t } = useTranslation("sync");
  const scanMut = useTriggerSyncScan();
  const [resolveTarget, setResolveTarget] = useState<SyncDiscrepancy | null>(null);

  const handleScan = async () => {
    try {
      const result = await scanMut.mutateAsync();
      const total = Number(result.total_scanned ?? 0);
      const found = Number(result.discrepancy_count ?? 0);
      toast.success(
        `Tarama tamamlandı — ${total} kullanıcı kontrol edildi, ${found} tutarsızlık bulundu.`,
      );
    } catch (e) {
      toast.error(extractBackendError(e));
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-fg-subtle">{t("loading")}</div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        Sync durumu yüklenemedi: {extractBackendError(error)}
      </div>
    );
  }

  const inSyncPct =
    data.total_ldap_users > 0
      ? Math.round((data.in_sync_count / data.total_ldap_users) * 100)
      : 100;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">{t("title")}</h1>
          <p className="text-sm text-fg-subtle">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-bg-inset disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
            />
            {t("refresh")}
          </button>
          <button
            type="button"
            onClick={handleScan}
            disabled={scanMut.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {scanMut.isPending ? t("scan.running") : t("scan.start")}
          </button>
        </div>
      </div>

      {/* Durum kartları */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          label={t("stats.ldapUsers")}
          value={data.total_ldap_users.toLocaleString("tr-TR")}
          icon={FolderTree}
        />
        <Card
          label={t("stats.dbUsers")}
          value={data.total_db_users.toLocaleString("tr-TR")}
          icon={Database}
        />
        <Card
          label={t("stats.inSync")}
          value={`${data.in_sync_count} (%${inSyncPct})`}
          icon={CheckCircle2}
          tone={inSyncPct === 100 ? "text-emerald-600" : "text-fg"}
        />
        <Card
          label={t("stats.discrepancies")}
          value={data.discrepancy_count.toLocaleString("tr-TR")}
          icon={GitCompareArrows}
          tone={data.discrepancy_count > 0 ? "text-amber-600" : "text-emerald-600"}
        />
      </div>

      {/* Son tarama zamanı */}
      <div className="rounded-lg border border-border bg-bg-surface px-4 py-2 text-xs text-fg-subtle">
        {t("lastScan")}{" "}
        <span className="font-mono text-fg">
          {data.last_scan_at
            ? new Date(data.last_scan_at).toLocaleString("tr-TR")
            : t("scan.never")}
        </span>
        {Object.keys(data.by_type).length > 0 && (
          <span className="ml-3">
            ·{" "}
            {Object.entries(data.by_type).map(([type, count]) => (
              <span key={type} className="mr-2">
                <span className="font-mono">{type}</span>:{" "}
                <span className="text-fg">{count}</span>
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Çözülmemiş tutarsızlık listesi */}
      <div className="rounded-lg border border-border bg-bg-surface">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">
              {t("unresolvedDiscrepancies")}
            </h2>
            <span className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-fg-subtle">
              {data.unresolved.length}
            </span>
          </div>
        </header>

        {data.unresolved.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
            <div className="text-sm font-medium text-fg">
              {t("allInSync")}
            </div>
            <div className="text-xs text-fg-subtle">
              {t("noDiscrepancies")}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.unresolved.map((d) => (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <DiscrepancyTypeBadge type={d.discrepancy_type} />
                      <span className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle">
                        {d.subject_type}
                      </span>
                      <span className="font-mono text-sm text-fg">
                        {d.subject_id}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                      {d.ldap_dn && (
                        <div className="truncate">
                          <span className="text-fg-subtle">{t("ldapPrefix")} </span>
                          <span className="font-mono text-fg">{d.ldap_dn}</span>
                        </div>
                      )}
                      {d.db_id && (
                        <div className="truncate">
                          <span className="text-fg-subtle">{t("dbPrefix")} </span>
                          <span className="font-mono text-fg">{d.db_id}</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-fg-subtle">
                      Keşfedildi:{" "}
                      {new Date(d.discovered_at).toLocaleString("tr-TR")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setResolveTarget(d)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-bg px-2.5 text-xs text-fg hover:bg-bg-inset"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    Çöz
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ResolveDiscrepancyDialog
        open={!!resolveTarget}
        discrepancy={resolveTarget}
        onClose={() => setResolveTarget(null)}
      />
    </div>
  );
}

function Card({
  label,
  value,
  icon: Icon,
  tone = "text-fg",
}: {
  label: string;
  value: string;
  icon: typeof Database;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-fg-subtle">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

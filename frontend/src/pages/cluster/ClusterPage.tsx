// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Server,
  ListChecks,
  Network,
  RefreshCw,
  Plus,
  Trash2,
  GitCompare,
  X,
  Loader2,
  Copy,
  Check,
} from "lucide-react";

import { NodeStatusBadge } from "@/components/cluster/NodeStatusBadge";
import { QueueStatusBadge } from "@/components/cluster/QueueStatusBadge";
import {
  useClusterQueue,
  useClusterStatus,
  useSyncState,
  useProvisionNode,
  useDeleteNode,
} from "@/hooks/useCluster";
import type { ClusterNode, ProvisionPayload, ProvisionResponse } from "@/types/cluster";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type Tab = "overview" | "nodes" | "sync" | "queue";

export default function ClusterPage() {
  const { t } = useTranslation("cluster");
  const [params, setParams] = useSearchParams();
  const tab = ((params.get("tab") as Tab) || "overview") as Tab;
  const setTab = (tb: Tab) => {
    const next = new URLSearchParams(params);
    next.set("tab", tb);
    setParams(next, { replace: true });
  };
  const queueStatusFilter = params.get("q") || "";
  const setQueueStatusFilter = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set("q", v);
    else next.delete("q");
    setParams(next, { replace: true });
  };

  const {
    data: status,
    isLoading: statusLoading,
    isError: statusError,
    error: statusErr,
    isFetching: statusFetching,
    refetch: refetchStatus,
  } = useClusterStatus();
  const { data: queue, isFetching: queueFetching, refetch: refetchQueue } =
    useClusterQueue({
      status: queueStatusFilter || undefined,
      limit: 100,
    });

  const isFetching = statusFetching || queueFetching;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">{t("title")}</h1>
          <p className="text-sm text-fg-subtle">{t("subtitle")}</p>
        </div>
        {tab !== "sync" && (
          <button
            type="button"
            onClick={() => {
              refetchStatus();
              refetchQueue();
            }}
            disabled={isFetching}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-bg-inset disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("refresh")}
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")} icon={Network}>
          {t("tabs.overview")}
        </TabBtn>
        <TabBtn
          active={tab === "nodes"}
          onClick={() => setTab("nodes")}
          icon={Server}
          badge={status?.nodes.length}
        >
          {t("tabs.nodes")}
        </TabBtn>
        <TabBtn active={tab === "sync"} onClick={() => setTab("sync")} icon={GitCompare}>
          {t("tabs.sync")}
        </TabBtn>
        <TabBtn
          active={tab === "queue"}
          onClick={() => setTab("queue")}
          icon={ListChecks}
          badge={status?.queue_pending}
          badgeTone={(status?.queue_pending ?? 0) > 0 ? "amber" : undefined}
        >
          {t("tabs.queue")}
        </TabBtn>
      </div>

      {statusError && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {t("loadError")}: {extractBackendError(statusErr)}
        </div>
      )}

      {tab === "overview" && <OverviewTab data={status} isLoading={statusLoading} />}
      {tab === "nodes" && (
        <NodesTab
          data={status?.nodes ?? []}
          isLoading={statusLoading}
          masterId={status?.master_node_id}
        />
      )}
      {tab === "sync" && <SyncStateTab />}
      {tab === "queue" && (
        <QueueTab
          items={queue ?? []}
          statusFilter={queueStatusFilter}
          onStatusFilter={setQueueStatusFilter}
          isLoading={queueFetching}
        />
      )}
    </div>
  );
}

// ============================================================================
function TabBtn({
  active,
  onClick,
  icon: Icon,
  badge,
  badgeTone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Server;
  badge?: number;
  badgeTone?: "amber";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
        active
          ? "border-amber text-amber"
          : "border-transparent text-fg-subtle hover:text-fg",
      ].join(" ")}
    >
      <Icon className="h-4 w-4" />
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className={[
            "rounded-full px-1.5 py-0 font-mono text-[10px]",
            badgeTone === "amber"
              ? "bg-amber-500/20 text-amber-600"
              : "bg-bg-inset text-fg-subtle",
          ].join(" ")}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ============================================================================
function OverviewTab({
  data,
  isLoading,
}: {
  data?: import("@/types/cluster").ClusterStatusSummary;
  isLoading: boolean;
}) {
  const { t } = useTranslation("cluster");
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-border bg-bg-surface"
          />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const queueIssue = data.queue_failed > 0;
  const nodeIssue = data.offline_nodes > 0 || data.degraded_nodes > 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label={t("stats.totalNodes")} value={data.total_nodes} icon={Server} />
        <Card
          label={t("stats.online")}
          value={data.online_nodes}
          icon={CheckCircle2}
          tone={data.online_nodes === data.total_nodes ? "text-emerald-600" : "text-fg"}
        />
        <Card
          label={t("stats.offlineDegraded")}
          value={data.offline_nodes + data.degraded_nodes}
          icon={AlertTriangle}
          tone={nodeIssue ? "text-amber-600" : "text-fg-subtle"}
        />
        <Card
          label={t("stats.queuePending")}
          value={data.queue_pending}
          icon={ListChecks}
          tone={
            data.queue_pending > 100
              ? "text-amber-600"
              : data.queue_pending > 0
                ? "text-fg"
                : "text-fg-subtle"
          }
        />
      </div>

      <div className="rounded-lg border border-border bg-bg-surface p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          {t("info.title")}
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <DD label={t("info.masterNode")} value={data.master_node_id ?? "—"} mono highlight={!!data.master_node_id} />
          <DD
            label={t("info.lastSync")}
            value={data.last_sync_at ? new Date(data.last_sync_at).toLocaleString("tr-TR") : t("info.never")}
            mono
          />
          <DD label={t("info.queueFailed")} value={data.queue_failed} mono highlight={queueIssue} danger={queueIssue} />
        </dl>
      </div>

      {(nodeIssue || queueIssue) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-medium">{t("health.title")}</div>
            <ul className="mt-1 list-disc pl-4 text-xs">
              {data.offline_nodes > 0 && <li>{data.offline_nodes} düğüm offline</li>}
              {data.degraded_nodes > 0 && <li>{data.degraded_nodes} düğüm degraded</li>}
              {queueIssue && <li>{t("health.queueFailedMessage", { count: data.queue_failed })}</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
function NodesTab({
  data,
  isLoading,
  masterId,
}: {
  data: ClusterNode[];
  isLoading: boolean;
  masterId?: string | null;
}) {
  const { t } = useTranslation("cluster");
  const [showAdd, setShowAdd] = useState(false);
  const deleteNode = useDeleteNode();

  const handleDelete = (n: ClusterNode) => {
    if (n.node_id === masterId) {
      toast.error(t("nodeForm.cannotDeleteMaster"));
      return;
    }
    if (!window.confirm(t("nodeForm.confirmDelete", { node: n.node_id }))) return;
    deleteNode.mutate(n.node_id, {
      onSuccess: () => toast.success(t("nodeForm.deleted", { node: n.node_id })),
      onError: (e) => toast.error(extractBackendError(e)),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber bg-amber/10 px-3 text-sm font-medium text-amber hover:bg-amber/20"
        >
          <Plus className="h-4 w-4" />
          {t("nodeForm.addButton")}
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-surface p-8 text-center text-fg-subtle">
          Cluster'a kayıtlı düğüm yok.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.map((n) => (
            <div
              key={n.id}
              className={[
                "rounded-lg border bg-bg-surface p-4",
                n.node_id === masterId ? "border-amber/40" : "border-border",
              ].join(" ")}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {n.node_id === masterId && <Crown className="h-4 w-4 text-amber" aria-label="Master" />}
                  <span className="font-mono text-sm font-medium text-fg">{n.node_id}</span>
                  <span className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                    {n.node_type}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <NodeStatusBadge status={n.status} />
                  {n.node_id !== masterId && (
                    <button
                      type="button"
                      onClick={() => handleDelete(n)}
                      disabled={deleteNode.isPending}
                      title={t("nodeForm.deleteTitle")}
                      className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <dl className="space-y-1.5 text-xs">
                <DD label={t("fields.hostname")} value={n.hostname} mono />
                <DD label={t("fields.baseUrl")} value={n.base_url} mono />
                <DD label={t("fields.version")} value={n.version ?? "—"} mono />
                <DD label={t("fields.registered")} value={new Date(n.registered_at).toLocaleString("tr-TR")} />
                <DD
                  label={t("fields.lastHeartbeat")}
                  value={n.last_heartbeat_at ? new Date(n.last_heartbeat_at).toLocaleString("tr-TR") : "—"}
                />
                <DD
                  label={t("info.lastSync")}
                  value={n.last_sync_at ? new Date(n.last_sync_at).toLocaleString("tr-TR") : "—"}
                />
              </dl>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddNodeForm onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ============================================================================
function AddNodeForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("cluster");
  const provision = useProvisionNode();
  const [form, setForm] = useState<ProvisionPayload>({
    node_id: "",
    hostname: "",
    ip: "",
  });
  const [result, setResult] = useState<ProvisionResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (k: keyof ProvisionPayload, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    if (
      !form.node_id.trim() ||
      !form.hostname.trim() ||
      !form.ip.trim()
    ) {
      toast.error(t("nodeForm.fillAll"));
      return;
    }
    provision.mutate(form, {
      onSuccess: (data) => setResult(data),
      onError: (e) => toast.error(extractBackendError(e)),
    });
  };

  const copyCommand = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.bootstrap_command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("provision.copyFailed"));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">
            {result ? t("provision.resultTitle") : t("provision.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-subtle hover:bg-bg-inset hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              {t("provision.resultIntro", { node: result.node.node_id })}
            </p>
            <div className="rounded-md border border-border bg-bg-inset p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-fg-subtle">
                  {t("provision.commandLabel")}
                </span>
                <button
                  type="button"
                  onClick={copyCommand}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:bg-bg-elevated hover:text-fg"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-accent" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? t("provision.copied") : t("provision.copy")}
                </button>
              </div>
              <code className="block whitespace-pre-wrap break-all font-mono text-xs text-fg">
                {result.bootstrap_command}
              </code>
            </div>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-fg-muted">
              <li>{t("provision.step1")}</li>
              <li>{t("provision.step2")}</li>
            </ol>
            <div className="rounded-md border border-amber/40 bg-amber/10 p-2.5 text-xs text-fg-muted">
              {t("provision.expires", {
                time: new Date(result.expires_at).toLocaleString("tr-TR"),
              })}
              <br />
              {t("provision.securityNote")}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md bg-amber px-4 text-sm font-medium text-fg-inverse hover:bg-amber-glow"
              >
                {t("provision.done")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <Field label={t("nodeForm.nodeId")} hint="mtl-slave-02">
                <input
                  value={form.node_id}
                  onChange={(e) => set("node_id", e.target.value)}
                  placeholder="mtl-slave-02"
                  className="h-9 w-full rounded-md border border-border bg-bg-inset px-3 font-mono text-sm text-fg placeholder:text-fg-subtle focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/40"
                />
              </Field>

              <Field label={t("nodeForm.hostname")} hint="mtl-slave-02.mtl.local">
                <input
                  value={form.hostname}
                  onChange={(e) => set("hostname", e.target.value)}
                  placeholder="mtl-slave-02.mtl.local"
                  className="h-9 w-full rounded-md border border-border bg-bg-inset px-3 font-mono text-sm text-fg placeholder:text-fg-subtle focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/40"
                />
              </Field>

              <Field label={t("provision.ip")} hint="192.0.2.45">
                <input
                  value={form.ip}
                  onChange={(e) => set("ip", e.target.value)}
                  placeholder="192.0.2.45"
                  className="h-9 w-full rounded-md border border-border bg-bg-inset px-3 font-mono text-sm text-fg placeholder:text-fg-subtle focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/40"
                />
              </Field>

            </div>

            <div className="mt-3 rounded-md border border-border bg-bg-inset/50 p-2.5 text-xs text-fg-subtle">
              {t("provision.formNote")}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md border border-border bg-bg px-4 text-sm text-fg hover:bg-bg-inset"
              >
                {t("common:cancel")}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={provision.isPending}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber px-4 text-sm font-medium text-fg-inverse hover:bg-amber-glow disabled:opacity-50"
              >
                {provision.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("provision.submit")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-fg-subtle">{label}</label>
      {children}
      {hint && <p className="mt-0.5 font-mono text-[10px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

// ============================================================================
function SyncStateTab() {
  const { t } = useTranslation("cluster");
  const { data, isLoading, isFetching, refetch, isError, error } = useSyncState();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-subtle">{t("syncState.subtitle")}</p>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 text-xs text-fg hover:bg-bg-inset disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {t("refresh")}
        </button>
      </div>

      {isError && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {extractBackendError(error)}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>
      ) : !data ? null : (
        <>
          <div className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs uppercase tracking-wider text-fg-subtle">
                {t("syncState.masterCsn")}
              </span>
              <span className="font-mono text-xs text-fg">{data.master_csn ?? "—"}</span>
            </div>
            <p className="mt-1 font-mono text-[10px] text-fg-subtle">
              {t("syncState.checkedAt")} {new Date(data.checked_at).toLocaleString("tr-TR")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.nodes.map((n) => {
              const ok = n.node_type === "MASTER" ? n.reachable : n.in_sync;
              return (
                <div
                  key={n.node_id}
                  className={[
                    "rounded-lg border bg-bg-surface p-4",
                    !n.reachable
                      ? "border-danger/40"
                      : ok
                        ? "border-emerald-500/30"
                        : "border-amber-500/40",
                  ].join(" ")}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium text-fg">{n.node_id}</span>
                    <SyncBadge reachable={n.reachable} inSync={n.in_sync} isMaster={n.node_type === "MASTER"} />
                  </div>
                  <dl className="space-y-1.5 text-xs">
                    <DD label={t("fields.baseUrl")} value={n.base_url} mono />
                    <DD label="contextCSN" value={n.csn ?? "—"} mono />
                  </dl>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SyncBadge({ reachable, inSync, isMaster }: { reachable: boolean; inSync: boolean; isMaster: boolean }) {
  const { t } = useTranslation("cluster");
  let tone: string;
  let label: string;
  if (!reachable) {
    tone = "bg-danger/10 text-danger border-danger/30";
    label = t("syncState.unreachable");
  } else if (isMaster) {
    tone = "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    label = t("syncState.master");
  } else if (inSync) {
    tone = "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    label = t("syncState.inSync");
  } else {
    tone = "bg-amber-500/10 text-amber-600 border-amber-500/30";
    label = t("syncState.lagging");
  }
  return (
    <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", tone].join(" ")}>
      {label}
    </span>
  );
}

// ============================================================================
function QueueTab({
  items,
  statusFilter,
  onStatusFilter,
  isLoading,
}: {
  items: import("@/types/cluster").SyncQueueItem[];
  statusFilter: string;
  onStatusFilter: (s: string) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation("cluster");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-fg-subtle">Filtrele:</span>
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-amber/50"
        >
          <option value="">{t("queue.allStatus")}</option>
          <option value="pending">Bekleyen</option>
          <option value="sent">Gönderildi</option>
          <option value="failed">Başarısız</option>
          <option value="abandoned">Vazgeçildi</option>
        </select>
        <span className="text-xs text-fg-subtle">{items.length} kayıt (max 100)</span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-surface p-8 text-center text-fg-subtle">
          {t("queue.empty")}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-bg-surface">
          <ul className="divide-y divide-border">
            {items.map((q) => (
              <li key={q.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <QueueStatusBadge status={q.status} />
                      <span className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle">
                        {q.payload_type}
                      </span>
                      <span className="font-mono text-xs text-fg">→ {q.target_node_id}</span>
                      <span className="font-mono text-[11px] text-fg-subtle">
                        deneme {q.attempts}/{q.max_attempts}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-fg-subtle">
                      {t("queue.entered")}{" "}
                      <span className="font-mono">{new Date(q.queued_at).toLocaleString("tr-TR")}</span>
                      {q.sent_at && (
                        <>
                          {" · Gönderildi: "}
                          <span className="font-mono text-emerald-600">
                            {new Date(q.sent_at).toLocaleString("tr-TR")}
                          </span>
                        </>
                      )}
                      {q.status === "pending" && (
                        <>
                          {" · Sonraki deneme: "}
                          <span className="font-mono">{new Date(q.next_attempt_at).toLocaleString("tr-TR")}</span>
                        </>
                      )}
                    </div>
                    {q.last_error && (
                      <div className="mt-1 rounded bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger">
                        {q.last_error}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================================
function Card({
  label,
  value,
  icon: Icon,
  tone = "text-fg",
}: {
  label: string;
  value: number;
  icon: typeof Server;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-fg-subtle">{label}</span>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value.toLocaleString("tr-TR")}</div>
    </div>
  );
}

function DD({
  label,
  value,
  mono = false,
  highlight = false,
  danger = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  highlight?: boolean;
  danger?: boolean;
}) {
  const valueCls = [
    mono ? "font-mono text-xs" : "text-sm",
    danger ? "text-danger" : highlight ? "text-fg font-medium" : "text-fg",
  ].join(" ");
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1 last:border-0">
      <dt className="flex-shrink-0 text-[10px] uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className={["min-w-0 truncate text-right", valueCls].join(" ")}>{value}</dd>
    </div>
  );
}

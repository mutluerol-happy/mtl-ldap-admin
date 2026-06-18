// SPDX-License-Identifier: Apache-2.0
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  Server,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Bell,
  ShieldCheck,
  Zap,
  UserPlus,
  Users2,
  KeyRound,
  ScrollText,
  Lock,
  UserX,
} from "lucide-react";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from "@/components/ui";
import { api, apiClient } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { formatRelative } from "@/lib/utils";

// ─── Dashboard summary types ─────────────────────────────────────────────────
interface RecentEvent {
  id: number;
  occurred_at: string;
  category: string;
  event_code: string;
  severity: string;
  actor_display: string | null;
  target_display: string | null;
}

interface ActiveAlertItem {
  id: string;
  rule_id: string;
  rule_code: string | null;
  rule_name: string | null;
  severity: string;
  summary: string;
  status: string;
  triggered_at: string;
}

interface SecuritySummaryData {
  total_admins: number;
  mfa_enrolled: number;
  mfa_enrollment_pct: number;
  locked_admins: number;
  inactive_admins: number;
  failed_login_24h: number;
}

interface DashboardSummaryData {
  recent_events: RecentEvent[];
  active_alerts: ActiveAlertItem[];
  security: SecuritySummaryData;
}

async function fetchDashboardSummary(): Promise<DashboardSummaryData> {
  const { data } = await apiClient.get<DashboardSummaryData>("/dashboard/summary");
  return data;
}

// ─── Page ────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const user = useAuthStore((s) => s.user);
  const canRead = useAuthStore((s) => s.hasPermission("audit.events.read"));

  const { data: cluster, isLoading: clusterLoading } = useQuery({
    queryKey: ["cluster-status"],
    queryFn: api.clusterStatus,
    enabled: canRead,
    refetchInterval: 30_000,
  });

  const { data: audit, isLoading: auditLoading } = useQuery({
    queryKey: ["audit-summary", 24],
    queryFn: () => api.auditSummary(24),
    enabled: canRead,
    refetchInterval: 60_000,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: fetchDashboardSummary,
    enabled: canRead,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      {/* Hoş geldin */}
      <div>
        <h1 className="h-display text-2xl">
          {t("welcome")},{" "}
          <span className="text-amber">{user?.display_name ?? user?.username}</span>
        </h1>
        <p className="text-sm text-fg-muted mt-1 font-mono">
          {formatRelative(user?.last_login_at)} · {t("lastLogin")}
        </p>
      </div>

      {!canRead && (
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Daha fazla içeriği görmek için{" "}
              <code className="code-inline">audit.events.read</code> yetkisi gerekiyor.
            </p>
          </CardContent>
        </Card>
      )}

      {canRead && (
        <>
          {/* Stat kartları */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Activity}
              label={t("stats.events24h")}
              value={audit?.total_events ?? "—"}
              loading={auditLoading}
              accent="amber"
            />
            <StatCard
              icon={CheckCircle2}
              label={t("stats.successfulLogins")}
              value={audit?.successful_login_count ?? "—"}
              loading={auditLoading}
              accent="success"
            />
            <StatCard
              icon={XCircle}
              label={t("stats.failedLogins")}
              value={audit?.failed_login_count ?? "—"}
              loading={auditLoading}
              accent={audit?.failed_login_count ? "danger" : "default"}
            />
            <StatCard
              icon={Server}
              label={t("stats.onlineNodes")}
              value={cluster ? `${cluster.online_nodes} / ${cluster.total_nodes}` : "—"}
              loading={clusterLoading}
              accent="success"
            />
          </div>

          {/* Cluster + üst event kodları (mevcut) */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  <Server className="inline h-3.5 w-3.5 -mt-0.5 mr-1.5" />
                  {t("cards.cluster")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {clusterLoading ? (
                  <Spinner size="md" />
                ) : cluster?.nodes?.length ? (
                  <ul className="space-y-2">
                    {cluster.nodes.map((n: any) => (
                      <li
                        key={n.node_id}
                        className="flex items-center justify-between py-2 border-b border-border last:border-b-0"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={
                              n.status === "online"
                                ? "status-dot status-dot-online"
                                : n.status === "offline"
                                  ? "status-dot status-dot-offline"
                                  : "status-dot status-dot-warning"
                            }
                          />
                          <div>
                            <div className="font-mono text-sm text-fg">{n.node_id}</div>
                            <div className="text-xs text-fg-subtle font-mono mt-0.5">
                              {n.node_type} · {n.hostname}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant={
                            n.status === "online"
                              ? "success"
                              : n.status === "offline"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {n.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-fg-muted">{t("cards.noData")}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <AlertTriangle className="inline h-3.5 w-3.5 -mt-0.5 mr-1.5" />
                  {t("cards.topEventCodes")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {auditLoading ? (
                  <Spinner size="md" />
                ) : audit?.top_event_codes?.length ? (
                  <ul className="space-y-1.5">
                    {audit.top_event_codes
                      .slice(0, 8)
                      .map((row: { event_code: string; count: number }) => (
                        <li
                          key={row.event_code}
                          className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-bg-elevated"
                        >
                          <span className="font-mono text-xs text-fg">{row.event_code}</span>
                          <Badge variant="muted">{row.count}</Badge>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-sm text-fg-muted">{t("cards.noData")}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* YENİ — Son olaylar + Aktif alarmlar */}
          <div className="grid gap-6 lg:grid-cols-2">
            <RecentEventsCard events={summary?.recent_events} loading={summaryLoading} />
            <ActiveAlertsCard alerts={summary?.active_alerts} loading={summaryLoading} />
          </div>

          {/* YENİ — Güvenlik özeti + Hızlı eylemler */}
          <div className="grid gap-6 lg:grid-cols-2">
            <SecuritySummaryCard security={summary?.security} loading={summaryLoading} />
            <QuickActionsCard />
          </div>
        </>
      )}
    </div>
  );
}

// ─── StatCard (mevcut, korundu) ──────────────────────────────────────────────
type Accent = "default" | "amber" | "success" | "danger";

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
  accent = "default",
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  loading?: boolean;
  accent?: Accent;
}) {
  const accentMap: Record<Accent, string> = {
    default: "text-fg",
    amber: "text-amber",
    success: "text-success",
    danger: "text-danger",
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="py-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-label mb-2">{label}</div>
            {loading ? (
              <div className="h-8 flex items-center">
                <Spinner size="sm" />
              </div>
            ) : (
              <div
                className={`text-3xl font-display font-bold tabular-nums ${accentMap[accent]}`}
              >
                {value}
              </div>
            )}
          </div>
          <Icon
            className={`h-5 w-5 ${accent === "default" ? "text-fg-subtle" : accentMap[accent]}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Severity badge map ─────────────────────────────────────────────────────
function severityVariant(s: string): "success" | "warning" | "danger" | "muted" {
  const sev = s.toUpperCase();
  if (sev === "CRITICAL" || sev === "ERROR") return "danger";
  if (sev === "WARNING") return "warning";
  if (sev === "NOTICE") return "muted";
  return "muted";
}

// ─── Recent Events Widget ───────────────────────────────────────────────────
function RecentEventsCard({
  events,
  loading,
}: {
  events?: RecentEvent[];
  loading: boolean;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          <ScrollText className="inline h-3.5 w-3.5 -mt-0.5 mr-1.5" />
          {t("cards.recentEvents")}
        </CardTitle>
        <Link
          to="/audit"
          className="text-xs font-mono text-fg-muted hover:text-fg"
        >
          {t("cards.all")}
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner size="md" />
        ) : events && events.length > 0 ? (
          <ul className="space-y-1.5">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-bg-elevated"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={severityVariant(ev.severity)} className="text-[10px]">
                      {ev.severity}
                    </Badge>
                    <span className="font-mono text-xs text-fg truncate">
                      {ev.event_code}
                    </span>
                  </div>
                  <div className="text-xs text-fg-subtle font-mono mt-0.5 truncate">
                    {ev.actor_display ?? "—"}
                    {ev.target_display ? ` → ${ev.target_display}` : ""}
                  </div>
                </div>
                <span className="text-xs text-fg-subtle font-mono shrink-0">
                  {formatRelative(ev.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">{t("cards.noEvents")}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Active Alerts Widget ───────────────────────────────────────────────────
function ActiveAlertsCard({
  alerts,
  loading,
}: {
  alerts?: ActiveAlertItem[];
  loading: boolean;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          <Bell className="inline h-3.5 w-3.5 -mt-0.5 mr-1.5" />
          {t("cards.activeAlerts")}
        </CardTitle>
        <Link
          to="/alerts"
          className="text-xs font-mono text-fg-muted hover:text-fg"
        >
          {t("cards.all")}
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner size="md" />
        ) : alerts && alerts.length > 0 ? (
          <ul className="space-y-1.5">
            {alerts.map((al) => (
              <li
                key={al.id}
                className="flex items-start justify-between gap-3 py-1.5 px-2 rounded hover:bg-bg-elevated"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={severityVariant(al.severity)} className="text-[10px]">
                      {al.severity}
                    </Badge>
                    <span className="font-mono text-xs text-fg truncate">
                      {al.rule_name ?? al.rule_code ?? "—"}
                    </span>
                    {al.status === "acknowledged" && (
                      <Badge variant="muted" className="text-[10px]">ack</Badge>
                    )}
                  </div>
                  <div className="text-xs text-fg-subtle mt-0.5 truncate">
                    {al.summary}
                  </div>
                </div>
                <span className="text-xs text-fg-subtle font-mono shrink-0">
                  {formatRelative(al.triggered_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">{t("cards.noActiveAlerts")}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Security Summary Widget ────────────────────────────────────────────────
function SecuritySummaryCard({
  security,
  loading,
}: {
  security?: SecuritySummaryData;
  loading: boolean;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ShieldCheck className="inline h-3.5 w-3.5 -mt-0.5 mr-1.5" />
          {t("cards.securitySummary")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner size="md" />
        ) : security ? (
          <div className="grid grid-cols-2 gap-3">
            <SecMetric
              icon={KeyRound}
              label={t("security.mfaEnrollment")}
              value={`%${security.mfa_enrollment_pct}`}
              hint={t("security.ofAdmins", { enrolled: security.mfa_enrolled, total: security.total_admins })}
              accent={security.mfa_enrollment_pct >= 80 ? "success" : security.mfa_enrollment_pct >= 50 ? "warning" : "danger"}
            />
            <SecMetric
              icon={XCircle}
              label={t("security.failedLogin24h")}
              value={security.failed_login_24h}
              accent={security.failed_login_24h > 10 ? "danger" : security.failed_login_24h > 0 ? "warning" : "success"}
            />
            <SecMetric
              icon={Lock}
              label={t("security.lockedAdmins")}
              value={security.locked_admins}
              accent={security.locked_admins > 0 ? "warning" : "default"}
            />
            <SecMetric
              icon={UserX}
              label={t("security.inactiveAdmins")}
              value={security.inactive_admins}
              accent={security.inactive_admins > 0 ? "muted" : "default"}
            />
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t("cards.noData")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function SecMetric({
  icon: Icon,
  label,
  value,
  hint,
  accent = "default",
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  hint?: string;
  accent?: "default" | "success" | "warning" | "danger" | "muted";
}) {
  const accentMap: Record<string, string> = {
    default: "text-fg",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    muted: "text-fg-muted",
  };
  return (
    <div className="p-3 rounded-md border border-border bg-bg-elevated">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] text-fg-subtle font-mono uppercase tracking-wider">
            {label}
          </div>
          <div className={`text-2xl font-display font-bold tabular-nums mt-1 ${accentMap[accent]}`}>
            {value}
          </div>
          {hint && <div className="text-[11px] text-fg-subtle font-mono mt-0.5">{hint}</div>}
        </div>
        <Icon className={`h-4 w-4 shrink-0 ${accentMap[accent]}`} />
      </div>
    </div>
  );
}

// ─── Quick Actions Widget ───────────────────────────────────────────────────
function QuickActionsCard() {
  const { t } = useTranslation("dashboard");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Zap className="inline h-3.5 w-3.5 -mt-0.5 mr-1.5" />
          {t("cards.quickActions")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction to="/users" icon={UserPlus} label={t("quickActions.users.label")} hint={t("quickActions.users.hint")} />
          <QuickAction to="/groups" icon={Users2} label={t("quickActions.groups.label")} hint={t("quickActions.groups.hint")} />
          <QuickAction to="/admins" icon={ShieldCheck} label={t("quickActions.admins.label")} hint={t("quickActions.admins.hint")} />
          <QuickAction to="/audit" icon={ScrollText} label={t("quickActions.audit.label")} hint={t("quickActions.audit.hint")} />
        </div>
      </CardContent>
    </Card>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
  hint,
}: {
  to: string;
  icon: typeof Activity;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="block p-3 rounded-md border border-border bg-bg-elevated hover:bg-muted transition-colors group"
    >
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 text-amber shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">{label}</div>
          <div className="text-[11px] text-fg-subtle font-mono mt-0.5">{hint}</div>
        </div>
      </div>
    </Link>
  );
}

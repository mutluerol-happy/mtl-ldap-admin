// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import {
  Lock,
  RefreshCw,
  Upload,
  FilePlus2,
  ArrowLeftRight,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Trash2,
  Power,
  Eye,
  PenLine,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/dialog/ConfirmDialog";
import { UploadCertDialog } from "@/components/shield/UploadCertDialog";
import { GenerateCsrDialog } from "@/components/shield/GenerateCsrDialog";
import { CaTransitionWizard } from "@/components/shield/CaTransitionWizard";
import { CertDetailModal } from "@/components/shield/CertDetailModal";
import {
  useShieldOverview,
  useCertificates,
  useCsrList,
  useActivateCertificate,
  useDeleteCertificate,
  useResignCsr,
} from "@/hooks/useShield";
import { shieldApi } from "@/lib/api.tur14-shield";
import { extractBackendError } from "@/types/common";
import { downloadText } from "@/lib/download";
import { formatDateTime } from "@/lib/utils";
import type { Certificate } from "@/types/shield";

type Tab = "overview" | "inventory" | "csr";

function ExpiryBadge({ cert }: { cert: Certificate }) {
  const { t } = useTranslation("shield");
  if (cert.is_expired) return <Badge variant="danger">{t("badges.expired")}</Badge>;
  const d = cert.days_remaining;
  if (d == null) return null;
  if (d < 30) return <Badge variant="warning">{t("badges.daysLeft", { d })}</Badge>;
  return <Badge variant="muted">{t("badges.daysLeft", { d })}</Badge>;
}

export default function ShieldPage() {
  const { t } = useTranslation(["shield", "common"]);
  const [tab, setTab] = useState<Tab>("overview");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [csrOpen, setCsrOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toActivate, setToActivate] = useState<Certificate | null>(null);
  const [toDelete, setToDelete] = useState<Certificate | null>(null);

  const overview = useShieldOverview();
  const certs = useCertificates();
  const csrs = useCsrList();
  const activate = useActivateCertificate();
  const del = useDeleteCertificate();
  const resign = useResignCsr();

  const refetchAll = () => {
    overview.refetch();
    certs.refetch();
    csrs.refetch();
  };

  const onExportCa = async () => {
    try {
      const r = await shieldApi.exportCa();
      downloadText("mtl-ca.pem", r.pem);
      toast.success(t("shield:overview.caExported"));
    } catch (e) {
      toast.error(extractBackendError(e));
    }
  };

  const doActivate = async () => {
    if (!toActivate) return;
    const res = await activate.mutateAsync(toActivate.id);
    toast.success(res.message);
    if (res.replication_warning) {
      toast.warning(res.replication_warning, { duration: 14_000 });
    }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    await del.mutateAsync(toDelete.id);
    toast.success(t("shield:inventory.deleted"));
  };

  const doResign = async (csrId: string, name: string) => {
    try {
      await resign.mutateAsync({ csrId, payload: { name: `${name}-mtlca`, days: 1825 } });
      toast.success(t("shield:csr.resigned"));
      setTab("inventory");
    } catch (e) {
      toast.error(extractBackendError(e));
    }
  };

  const isFetching = overview.isFetching || certs.isFetching || csrs.isFetching;

  return (
    <div className="space-y-4">
      {/* Başlık + aksiyonlar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Lock className="h-6 w-6 text-fg-subtle" />
          <div>
            <h1 className="text-xl font-semibold text-fg">{t("shield:title")}</h1>
            <p className="text-sm text-fg-subtle">{t("shield:subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" /> {t("shield:actions.upload")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCsrOpen(true)}>
            <FilePlus2 className="h-4 w-4" /> {t("shield:actions.genCsr")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setTransitionOpen(true)}>
            <ArrowLeftRight className="h-4 w-4" /> {t("shield:actions.transition")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onExportCa}>
            <Download className="h-4 w-4" /> {t("shield:actions.exportCa")}
          </Button>
          <Button variant="ghost" size="sm" onClick={refetchAll} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Sekmeler */}
      <div className="flex gap-1 border-b border-border">
        {(["overview", "inventory", "csr"] as Tab[]).map((tk) => (
          <button
            key={tk}
            type="button"
            onClick={() => setTab(tk)}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === tk
                ? "border-amber text-amber"
                : "border-transparent text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            {t(`shield:tabs.${tk}`)}
          </button>
        ))}
      </div>

      {/* GENEL BAKIŞ */}
      {tab === "overview" && (
        <div className="space-y-4">
          {overview.data?.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{w}</span>
            </div>
          ))}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ActiveCard title={t("shield:overview.activeServer")} cert={overview.data?.active_server ?? null} />
            <ActiveCard title={t("shield:overview.activeCa")} cert={overview.data?.active_ca ?? null} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("shield:overview.liveEndpoints")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {overview.data?.endpoints.map((ep) => (
                <div
                  key={ep.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg-inset px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {ep.reachable ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <XCircle className="h-4 w-4 text-danger" />
                    )}
                    <span className="font-mono text-sm text-fg">
                      {ep.name} · {ep.host}:{ep.port}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {ep.matches_active === true && <Badge variant="success">{t("shield:overview.match")}</Badge>}
                    {ep.matches_active === false && <Badge variant="warning">{t("shield:overview.mismatch")}</Badge>}
                    {ep.error && <span className="text-xs text-danger">{ep.error}</span>}
                    {ep.fingerprint_sha256 && (
                      <span className="font-mono text-[0.65rem] text-fg-subtle truncate max-w-[14rem]">
                        {ep.fingerprint_sha256}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ENVANTER */}
      {tab === "inventory" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-fg-subtle">
                    <th className="px-4 py-3">{t("shield:fields.name")}</th>
                    <th className="px-4 py-3">{t("shield:fields.type")}</th>
                    <th className="px-4 py-3">{t("shield:fields.subject")}</th>
                    <th className="px-4 py-3">{t("shield:fields.notAfter")}</th>
                    <th className="px-4 py-3">{t("shield:fields.status")}</th>
                    <th className="px-4 py-3 text-right">{t("common:actions", { defaultValue: "İşlemler" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {(certs.data ?? []).map((c) => (
                    <tr key={c.id} className="border-b border-border hover:bg-bg-elevated/50">
                      <td className="px-4 py-3 font-medium text-fg">{c.name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="amber">{c.type}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-fg-muted max-w-[18rem] truncate" title={c.subject}>
                        {c.subject}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-fg-muted">{formatDateTime(c.not_after)}</span>
                          <ExpiryBadge cert={c} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {c.is_active ? (
                          <Badge variant="success">{t("shield:badges.active")}</Badge>
                        ) : (
                          <Badge variant="muted">{t("shield:badges.inactive")}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setDetailId(c.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!c.is_active && (
                            <Button variant="ghost" size="sm" onClick={() => setToActivate(c)}>
                              <Power className="h-4 w-4 text-amber" />
                            </Button>
                          )}
                          {!c.is_active && (
                            <Button variant="ghost" size="sm" onClick={() => setToDelete(c)}>
                              <Trash2 className="h-4 w-4 text-danger" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {certs.data && certs.data.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-fg-subtle">
                        {t("shield:inventory.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CSR */}
      {tab === "csr" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-fg-subtle">
                    <th className="px-4 py-3">{t("shield:fields.name")}</th>
                    <th className="px-4 py-3">{t("shield:fields.subject")}</th>
                    <th className="px-4 py-3">{t("shield:fields.status")}</th>
                    <th className="px-4 py-3">{t("shield:fields.created")}</th>
                    <th className="px-4 py-3 text-right">{t("common:actions", { defaultValue: "İşlemler" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {(csrs.data ?? []).map((c) => (
                    <tr key={c.id} className="border-b border-border hover:bg-bg-elevated/50">
                      <td className="px-4 py-3 font-medium text-fg">{c.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-fg-muted max-w-[18rem] truncate" title={c.subject}>
                        {c.subject}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={c.status === "FULFILLED" ? "success" : c.status === "CANCELLED" ? "muted" : "info"}>
                          {c.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-fg-muted">{formatDateTime(c.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {c.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={resign.isPending}
                              onClick={() => doResign(c.id, c.name)}
                            >
                              <PenLine className="h-4 w-4" /> {t("shield:csr.resign")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {csrs.data && csrs.data.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-fg-subtle">
                        {t("shield:csr.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialoglar */}
      <UploadCertDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <GenerateCsrDialog open={csrOpen} onClose={() => setCsrOpen(false)} />
      <CaTransitionWizard
        open={transitionOpen}
        onClose={() => setTransitionOpen(false)}
        onDone={(res) => {
          toast.success(res.message);
          if (res.replication_warning) toast.warning(res.replication_warning, { duration: 14_000 });
        }}
      />
      <CertDetailModal certId={detailId} onClose={() => setDetailId(null)} />

      <ConfirmDialog
        open={!!toActivate}
        onClose={() => setToActivate(null)}
        onConfirm={doActivate}
        title={t("shield:activate.title")}
        description={t("shield:activate.description", { name: toActivate?.name ?? "" })}
        confirmLabel={t("shield:activate.confirm")}
      />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={doDelete}
        variant="danger"
        title={t("shield:delete.title")}
        description={t("shield:delete.description")}
        confirmText={toDelete?.name}
        confirmLabel={t("common:delete", { defaultValue: "Sil" })}
      />
    </div>
  );
}

function ActiveCard({ title, cert }: { title: string; cert: Certificate | null }) {
  const { t } = useTranslation("shield");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {cert ? <Badge variant="success">{t("badges.active")}</Badge> : <Badge variant="muted">—</Badge>}
      </CardHeader>
      <CardContent>
        {cert ? (
          <div className="space-y-1.5 text-sm">
            <div className="font-medium text-fg">{cert.name}</div>
            <div className="font-mono text-xs text-fg-muted break-all">{cert.subject}</div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-fg-subtle">{t("fields.notAfter")}:</span>
              <span className="text-fg-muted">{formatDateTime(cert.not_after)}</span>
              <ExpiryBadge cert={cert} />
            </div>
            <div className="font-mono text-[0.65rem] text-fg-subtle break-all pt-1">
              {cert.fingerprint_sha256}
            </div>
          </div>
        ) : (
          <div className="py-4 text-center text-sm text-fg-subtle">{t("overview.none")}</div>
        )}
      </CardContent>
    </Card>
  );
}

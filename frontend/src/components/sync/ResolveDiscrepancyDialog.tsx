// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Modal } from "@/components/dialog/Modal";
import {
  DISCREPANCY_ACTIONS,
  type DiscrepancyAction,
  type SyncDiscrepancy,
} from "@/types/sync";
import { useResolveSyncDiscrepancy } from "@/hooks/useSync";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export interface ResolveDiscrepancyDialogProps {
  open: boolean;
  discrepancy: SyncDiscrepancy | null;
  onClose: () => void;
}

export function ResolveDiscrepancyDialog({
  open,
  discrepancy,
  onClose,
}: ResolveDiscrepancyDialogProps) {
  const { t } = useTranslation("common");
  const [selected, setSelected] = useState<DiscrepancyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolveMut = useResolveSyncDiscrepancy();

  // Tutarsızlık tipine göre GEÇERLİ aksiyonlar (backend _valid ile birebir)
  const validActions = (() => {
    if (!discrepancy) return new Set<DiscrepancyAction>();
    switch (discrepancy.discrepancy_type) {
      case "orphan_ldap":
        return new Set<DiscrepancyAction>(["create_db", "delete_ldap", "ignore"]);
      case "orphan_db":
        return new Set<DiscrepancyAction>(["delete_db", "ignore"]);
      case "attribute_drift":
      case "mfa_flag_drift":
        return new Set<DiscrepancyAction>(["sync_attribute", "ignore"]);
      default:
        return new Set<DiscrepancyAction>(DISCREPANCY_ACTIONS.map((a) => a.value));
    }
  })();
  // Tür için ana (güvenli) öneri — yıkıcı silmeyi varsayılan önermeyiz
  const recommendedAction: DiscrepancyAction | null = (() => {
    if (!discrepancy) return null;
    switch (discrepancy.discrepancy_type) {
      case "orphan_ldap":
        return "create_db";
      case "attribute_drift":
      case "mfa_flag_drift":
        return "sync_attribute";
      default:
        return null; // orphan_db: silme yıkıcı, admin seçsin
    }
  })();

  // Dialog açılınca önerilen aksiyonu ön-seç
  useEffect(() => {
    if (open && discrepancy) setSelected(recommendedAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, discrepancy?.id]);

  const handleClose = () => {
    setSelected(null);
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!discrepancy || !selected) return;
    setError(null);
    try {
      await resolveMut.mutateAsync({
        discrepancy_id: discrepancy.id,
        action: selected,
      });
      handleClose();
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  if (!discrepancy) {
    return (
      <Modal open={open} onClose={handleClose} title="Tutarsızlık Çöz" size="md">
        <div className="text-sm text-fg-subtle">Tutarsızlık seçilmedi.</div>
      </Modal>
    );
  }

  const isDanger = selected
    ? DISCREPANCY_ACTIONS.find((a) => a.value === selected)?.danger
    : false;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Tutarsızlık Çöz"
      description={
        <span className="font-mono text-xs">
          {discrepancy.subject_type} · {discrepancy.subject_id}
        </span>
      }
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={resolveMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selected || resolveMut.isPending}
            className={[
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-white disabled:opacity-50",
              isDanger
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-primary hover:bg-primary/90",
            ].join(" ")}
          >
            {resolveMut.isPending ? "Uygulanıyor…" : "Uygula"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Tutarsızlık özeti */}
        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-bg px-1.5 py-0.5 font-mono text-fg">
              {discrepancy.discrepancy_type}
            </span>
            <span className="text-fg-subtle">
              Keşfedildi: {new Date(discrepancy.discovered_at).toLocaleString("tr-TR")}
            </span>
          </div>
          {discrepancy.ldap_dn && (
            <div className="mt-1">
              <span className="text-fg-subtle">LDAP DN: </span>
              <span className="font-mono text-fg">{discrepancy.ldap_dn}</span>
            </div>
          )}
          {discrepancy.db_id && (
            <div className="mt-0.5">
              <span className="text-fg-subtle">DB ID: </span>
              <span className="font-mono text-fg">{discrepancy.db_id}</span>
            </div>
          )}
          {Object.keys(discrepancy.diff_details).length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-fg-subtle">
                Diff detayları
              </summary>
              <pre className="mt-1 overflow-x-auto rounded bg-bg p-2 font-mono text-[11px] text-fg">
                {JSON.stringify(discrepancy.diff_details, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Aksiyon seçim */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Eylem Seç
          </h3>
          <div className="space-y-1.5">
            {DISCREPANCY_ACTIONS.filter((a) => validActions.has(a.value)).map((a) => {
              const isRec = a.value === recommendedAction;
              const isSel = selected === a.value;
              return (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setSelected(a.value)}
                  className={[
                    "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition",
                    isSel
                      ? a.danger
                        ? "border-destructive bg-destructive/5"
                        : "border-primary bg-primary/5"
                      : "border-border bg-bg hover:bg-muted",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    checked={isSel}
                    readOnly
                    className="mt-1 h-4 w-4 flex-shrink-0 pointer-events-none"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "font-mono text-sm font-medium",
                          a.danger ? "text-destructive" : "text-fg",
                        ].join(" ")}
                      >
                        {a.label}
                      </span>
                      {isRec && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">
                          önerilen
                        </span>
                      )}
                      {a.danger && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          yıkıcı
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-fg-subtle">{a.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {isDanger && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            Bu eylem geri alınamaz. Yedek aldığınızdan emin olun.
          </div>
        )}
      </div>
    </Modal>
  );
}

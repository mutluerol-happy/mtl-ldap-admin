// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Modal } from "@/components/dialog/Modal";
import { Button } from "@/components/ui/Button";
import { useCertificates, useTransitionActivate } from "@/hooks/useShield";
import { extractBackendError } from "@/types/common";
import type { CertActivateResponse } from "@/types/shield";

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: (res: CertActivateResponse) => void;
}

const FIELD =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg " +
  "focus:outline-none focus:ring-2 focus:ring-amber/50";
const LABEL = "block text-xs font-medium uppercase tracking-wider text-fg-subtle mb-1";

export function CaTransitionWizard({ open, onClose, onDone }: Props) {
  const { t } = useTranslation(["shield", "common"]);
  const { data: certs } = useCertificates();
  const transition = useTransitionActivate();

  const [caId, setCaId] = useState("");
  const [serverId, setServerId] = useState("");

  const caOptions = useMemo(
    () => (certs ?? []).filter((c) => c.type === "CA" && !c.is_expired),
    [certs],
  );
  const serverOptions = useMemo(
    () => (certs ?? []).filter((c) => c.type === "SERVER" && c.has_private_key && !c.is_expired),
    [certs],
  );

  const close = () => {
    setCaId("");
    setServerId("");
    onClose();
  };

  const submit = async () => {
    if (!caId || !serverId) {
      toast.error(t("shield:transition.selectBoth"));
      return;
    }
    try {
      const res = await transition.mutateAsync({ ca_id: caId, server_id: serverId });
      onDone(res);
      close();
    } catch (e) {
      toast.error(extractBackendError(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={transition.isPending ? () => undefined : close}
      title={t("shield:transition.title")}
      description={t("shield:transition.subtitle")}
      size="lg"
      closeOnBackdrop={!transition.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={transition.isPending}>
            {t("common:cancel")}
          </Button>
          <Button variant="danger" onClick={submit} loading={transition.isPending}>
            {t("shield:transition.activate")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("shield:transition.warning")}</span>
        </div>

        <div>
          <label className={LABEL}>{t("shield:transition.caCert")}</label>
          <select className={FIELD} value={caId} onChange={(e) => setCaId(e.target.value)}>
            <option value="">— {t("shield:transition.choose")} —</option>
            {caOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.subject}
              </option>
            ))}
          </select>
          {caOptions.length === 0 && (
            <p className="mt-1 text-xs text-fg-subtle">{t("shield:transition.noCa")}</p>
          )}
        </div>

        <div>
          <label className={LABEL}>{t("shield:transition.serverCert")}</label>
          <select className={FIELD} value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">— {t("shield:transition.choose")} —</option>
            {serverOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.subject}
              </option>
            ))}
          </select>
          {serverOptions.length === 0 && (
            <p className="mt-1 text-xs text-fg-subtle">{t("shield:transition.noServer")}</p>
          )}
        </div>

        <p className="text-xs text-fg-subtle">{t("shield:transition.chainNote")}</p>
      </div>
    </Modal>
  );
}

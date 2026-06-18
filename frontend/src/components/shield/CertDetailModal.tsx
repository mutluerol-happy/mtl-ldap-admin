// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Modal } from "@/components/dialog/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useQuery } from "@tanstack/react-query";
import { shieldApi } from "@/lib/api.tur14-shield";
import { shieldKeys } from "@/hooks/useShield";
import { downloadText } from "@/lib/download";
import { formatDateTime } from "@/lib/utils";

interface Props {
  certId: string | null;
  onClose: () => void;
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5">
      <div className="text-xs uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className={`col-span-2 break-all text-sm text-fg ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export function CertDetailModal({ certId, onClose }: Props) {
  const { t } = useTranslation(["shield", "common"]);
  const { data, isLoading } = useQuery({
    queryKey: certId ? shieldKeys.certificate(certId) : ["shield", "certificate", "none"],
    queryFn: () => shieldApi.getCertificate(certId as string),
    enabled: !!certId,
  });

  return (
    <Modal
      open={!!certId}
      onClose={onClose}
      title={data?.name ?? t("shield:detail.title")}
      size="xl"
      footer={
        <>
          {data && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadText(`${data.name}.pem`, data.pem_data)}
            >
              <Download className="h-4 w-4" /> {t("shield:detail.downloadPem")}
            </Button>
          )}
          <Button onClick={onClose}>{t("common:close", { defaultValue: "Kapat" })}</Button>
        </>
      }
    >
      {isLoading || !data ? (
        <div className="py-8 text-center text-sm text-fg-subtle">{t("common:loading", { defaultValue: "Yükleniyor…" })}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="amber">{data.type}</Badge>
            {data.is_active && <Badge variant="success">{t("shield:badges.active")}</Badge>}
            {data.is_self_signed && <Badge variant="muted">self-signed</Badge>}
            {data.is_expired && <Badge variant="danger">{t("shield:badges.expired")}</Badge>}
            {data.has_private_key && <Badge variant="info">{t("shield:badges.hasKey")}</Badge>}
          </div>
          <div className="divide-y divide-border rounded-md border border-border px-3">
            <Row label={t("shield:fields.subject")} value={data.subject} mono />
            <Row label={t("shield:fields.issuer")} value={data.issuer} mono />
            <Row label={t("shield:fields.serial")} value={data.serial_number} mono />
            <Row label={t("shield:fields.fingerprint")} value={data.fingerprint_sha256} mono />
            <Row label={t("shield:fields.notBefore")} value={formatDateTime(data.not_before)} />
            <Row label={t("shield:fields.notAfter")} value={formatDateTime(data.not_after)} />
            <Row label={t("shield:fields.source")} value={data.source} />
            {data.description && (
              <Row label={t("shield:fields.description")} value={data.description} />
            )}
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-fg-subtle">PEM</div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-bg-inset p-3 font-mono text-xs text-fg-muted whitespace-pre-wrap break-all">
              {data.pem_data}
            </pre>
          </div>
        </div>
      )}
    </Modal>
  );
}

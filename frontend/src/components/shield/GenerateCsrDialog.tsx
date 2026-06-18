// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { Download, Copy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Modal } from "@/components/dialog/Modal";
import { Button } from "@/components/ui/Button";
import { useGenerateCsr } from "@/hooks/useShield";
import { extractBackendError } from "@/types/common";
import { downloadText } from "@/lib/download";

interface Props {
  open: boolean;
  onClose: () => void;
}

const FIELD =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg " +
  "focus:outline-none focus:ring-2 focus:ring-amber/50";
const LABEL = "block text-xs font-medium uppercase tracking-wider text-fg-subtle mb-1";

export function GenerateCsrDialog({ open, onClose }: Props) {
  const { t } = useTranslation(["shield", "common"]);
  const gen = useGenerateCsr();

  const [name, setName] = useState("");
  const [cn, setCn] = useState("");
  const [org, setOrg] = useState("MTL");
  const [country, setCountry] = useState("TR");
  const [sanDns, setSanDns] = useState("");
  const [sanIp, setSanIp] = useState("");
  const [keyBits, setKeyBits] = useState<2048 | 4096>(4096);
  const [csrPem, setCsrPem] = useState<string | null>(null);
  const [csrName, setCsrName] = useState("");

  const reset = () => {
    setName("");
    setCn("");
    setOrg("MTL");
    setCountry("TR");
    setSanDns("");
    setSanIp("");
    setKeyBits(4096);
    setCsrPem(null);
    setCsrName("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const split = (s: string) =>
    s.split(",").map((x) => x.trim()).filter(Boolean);

  const submit = async () => {
    if (!name.trim() || !cn.trim()) {
      toast.error(t("shield:csr.fillRequired"));
      return;
    }
    try {
      const res = await gen.mutateAsync({
        name: name.trim(),
        common_name: cn.trim(),
        organization: org.trim() || "MTL",
        country: (country.trim() || "TR").toUpperCase().slice(0, 2),
        san_dns: split(sanDns),
        san_ip: split(sanIp),
        key_bits: keyBits,
      });
      setCsrPem(res.csr_pem);
      setCsrName(res.csr.name);
      toast.success(t("shield:csr.success"));
    } catch (e) {
      toast.error(extractBackendError(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={gen.isPending ? () => undefined : close}
      title={t("shield:csr.title")}
      description={t("shield:csr.subtitle")}
      size="lg"
      closeOnBackdrop={!gen.isPending}
      footer={
        csrPem ? (
          <Button onClick={close}>{t("common:close", { defaultValue: "Kapat" })}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={gen.isPending}>
              {t("common:cancel")}
            </Button>
            <Button onClick={submit} loading={gen.isPending}>
              {t("shield:csr.submit")}
            </Button>
          </>
        )
      }
    >
      {csrPem ? (
        <div className="space-y-3">
          <p className="text-sm text-fg">{t("shield:csr.resultNote")}</p>
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-bg-inset p-3 font-mono text-xs text-fg-muted whitespace-pre-wrap break-all">
            {csrPem}
          </pre>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadText(`${csrName || "request"}.csr`, csrPem)}
            >
              <Download className="h-4 w-4" /> {t("shield:csr.download")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(csrPem);
                toast.success(t("shield:csr.copied"));
              }}
            >
              <Copy className="h-4 w-4" /> {t("common:copy", { defaultValue: "Kopyala" })}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("shield:fields.name")}</label>
              <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className={LABEL}>{t("shield:fields.commonName")}</label>
              <input
                className={FIELD}
                value={cn}
                onChange={(e) => setCn(e.target.value)}
                placeholder="mtl-master-01.mtl.local"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={LABEL}>{t("shield:fields.organization")}</label>
              <input className={FIELD} value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className={LABEL}>{t("shield:fields.country")}</label>
              <input
                className={FIELD}
                value={country}
                maxLength={2}
                onChange={(e) => setCountry(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={LABEL}>{t("shield:fields.sanDns")}</label>
              <input
                className={FIELD}
                value={sanDns}
                onChange={(e) => setSanDns(e.target.value)}
                placeholder="alt1.mtl.local, alt2.mtl.local"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={LABEL}>{t("shield:fields.sanIp")}</label>
              <input
                className={FIELD}
                value={sanIp}
                onChange={(e) => setSanIp(e.target.value)}
                placeholder="192.0.2.42"
                autoComplete="off"
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>{t("shield:fields.keyBits")}</label>
            <select
              value={keyBits}
              onChange={(e) => setKeyBits(Number(e.target.value) === 2048 ? 2048 : 4096)}
              className={FIELD}
            >
              <option value={4096}>4096</option>
              <option value={2048}>2048</option>
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}

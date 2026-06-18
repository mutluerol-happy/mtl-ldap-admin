// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Modal } from "@/components/dialog/Modal";
import { Button } from "@/components/ui/Button";
import { useUploadCertificate } from "@/hooks/useShield";
import { extractBackendError } from "@/types/common";
import type { CertType } from "@/types/shield";

interface Props {
  open: boolean;
  onClose: () => void;
}

const FIELD =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg " +
  "focus:outline-none focus:ring-2 focus:ring-amber/50";
const LABEL = "block text-xs font-medium uppercase tracking-wider text-fg-subtle mb-1";

export function UploadCertDialog({ open, onClose }: Props) {
  const { t } = useTranslation(["shield", "common"]);
  const upload = useUploadCertificate();

  const [type, setType] = useState<CertType>("SERVER");
  const [name, setName] = useState("");
  const [pem, setPem] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setType("SERVER");
    setName("");
    setPem("");
    setKey("");
    setDescription("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!name.trim() || !pem.trim()) {
      toast.error(t("shield:upload.fillRequired"));
      return;
    }
    if (type === "SERVER" && !key.trim()) {
      toast.error(t("shield:upload.serverNeedsKey"));
      return;
    }
    try {
      await upload.mutateAsync({
        name: name.trim(),
        type,
        pem: pem.trim(),
        private_key: type === "SERVER" ? key.trim() : null,
        description: description.trim() || null,
      });
      toast.success(t("shield:upload.success"));
      close();
    } catch (e) {
      toast.error(extractBackendError(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={upload.isPending ? () => undefined : close}
      title={t("shield:upload.title")}
      description={t("shield:upload.subtitle")}
      size="lg"
      closeOnBackdrop={!upload.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={upload.isPending}>
            {t("common:cancel")}
          </Button>
          <Button onClick={submit} loading={upload.isPending}>
            {t("shield:upload.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>{t("shield:fields.type")}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CertType)}
              className={FIELD}
            >
              <option value="SERVER">SERVER</option>
              <option value="CA">CA</option>
              <option value="CLIENT">CLIENT</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>{t("shield:fields.name")}</label>
            <input
              className={FIELD}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("shield:upload.namePlaceholder")}
              autoComplete="off"
            />
          </div>
        </div>

        <div>
          <label className={LABEL}>{t("shield:fields.pem")}</label>
          <textarea
            className={`${FIELD} h-40 font-mono text-xs`}
            value={pem}
            onChange={(e) => setPem(e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----"
            spellCheck={false}
          />
        </div>

        {type === "SERVER" && (
          <div>
            <label className={LABEL}>{t("shield:fields.privateKey")}</label>
            <textarea
              className={`${FIELD} h-32 font-mono text-xs`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-fg-subtle">{t("shield:upload.keyNote")}</p>
          </div>
        )}

        <div>
          <label className={LABEL}>{t("shield:fields.description")}</label>
          <input
            className={FIELD}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
    </Modal>
  );
}

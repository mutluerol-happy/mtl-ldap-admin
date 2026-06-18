// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";

import { Modal } from "@/components/dialog/Modal";
import { useAcknowledgeAlert, useResolveAlert } from "@/hooks/useAlerts";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

// ============================================================================
// Acknowledge
// ============================================================================
export function AckAlertDialog({
  open,
  eventId,
  onClose,
}: {
  open: boolean;
  eventId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ackMut = useAcknowledgeAlert(eventId ?? "");

  useEffect(() => {
    if (open) {
      setNote("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!eventId) return;
    setError(null);
    try {
      await ackMut.mutateAsync({ note: note.trim() || null });
      onClose();
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  return (
    <Modal
      open={open && !!eventId}
      onClose={onClose}
      title="Alert'i Onayla"
      description={t("resolve.ackDescription")}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={ackMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={ackMut.isPending}
            className="inline-flex h-9 items-center rounded-md bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-600/90 disabled:opacity-50"
          >
            {ackMut.isPending ? t("resolve.acking") : t("resolve.ack")}
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
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-fg-subtle">
            Not (opsiyonel)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1024}
            placeholder={t("resolve.ackNotePlaceholder")}
            className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </label>
        <p className="text-xs text-fg-subtle">
          Acknowledge, alert'i "açık → onaylandı" durumuna geçirir. Hala çözülmemiş sayılır,
          ancak ekibin haberi olduğunu belgeler.
        </p>
      </div>
    </Modal>
  );
}

// ============================================================================
// Resolve
// ============================================================================
export function ResolveAlertDialog({
  open,
  eventId,
  onClose,
}: {
  open: boolean;
  eventId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resolveMut = useResolveAlert(eventId ?? "");

  useEffect(() => {
    if (open) {
      setNote("");
      setError(null);
    }
  }, [open]);

  const valid = note.trim().length >= 1;

  const submit = async () => {
    if (!eventId || !valid) return;
    setError(null);
    try {
      await resolveMut.mutateAsync({ note: note.trim() });
      onClose();
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  return (
    <Modal
      open={open && !!eventId}
      onClose={onClose}
      title={t("resolve.title")}
      description={t("resolve.description")}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={resolveMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || resolveMut.isPending}
            className="inline-flex h-9 items-center rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-600/90 disabled:opacity-50"
          >
            {resolveMut.isPending ? t("resolve.submitting") : t("resolve.submit")}
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
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-fg-subtle">
            Çözüm Notu <span className="text-destructive">*</span>
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            minLength={1}
            maxLength={2048}
            placeholder={t("resolve.resolveNotePlaceholder")}
            className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {!valid && note.length > 0 && (
            <span className="mt-1 block text-xs text-destructive">
              En az 1 karakter zorunlu (backend gereksinimi)
            </span>
          )}
        </label>
        <p className="text-xs text-fg-subtle">
          Çözüm notu zorunludur. Alert "çözüldü" durumuna geçer ve audit log'a kayıt
          düşülür.
        </p>
      </div>
    </Modal>
  );
}

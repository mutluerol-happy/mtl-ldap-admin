// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { ReactNode, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";
import { useTranslation } from "react-i18next";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  /**
   * Verildiğinde kullanıcının onayı için bu string'i tam olarak yazması istenir.
   * (örn. silinecek kaynağın adı)
   */
  confirmText?: string;
  /**
   * Eğer true ise modal kapanmadan onConfirm beklenir; mutation tamamlanmadan
   * kullanıcı tekrar Confirm'a basamaz.
   */
  awaitConfirm?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Onayla",
  cancelLabel,
  variant = "default",
  confirmText,
  awaitConfirm = true,
}: ConfirmDialogProps) {
  const { t } = useTranslation("common");
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped("");
      setPending(false);
    }
  }, [open]);

  const isDanger = variant === "danger";
  const matches = !confirmText || typed === confirmText;

  const handleConfirm = async () => {
    if (!matches || pending) return;
    try {
      setPending(true);
      const r = onConfirm();
      if (awaitConfirm && r instanceof Promise) {
        await r;
      }
      onClose();
    } catch {
      // Hata yönetimi mutation tarafında yapılır; modal açık kalır.
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={pending ? () => undefined : onClose}
      title={
        <span className="flex items-center gap-2">
          {isDanger && (
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
          )}
          {title}
        </span>
      }
      size="sm"
      closeOnBackdrop={!pending}
      closeOnEscape={!pending}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            {cancelLabel ?? t("common:cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!matches || pending}
            className={[
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed",
              isDanger
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-primary hover:bg-primary/90",
            ].join(" ")}
          >
            {pending ? t("common:applying") : confirmLabel}
          </button>
        </>
      }
    >
      {description && <div className="text-sm text-fg">{description}</div>}

      {confirmText && (
        <div className="mt-4">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Onaylamak için <span className="font-mono normal-case text-fg">{confirmText}</span>{" "}
            yazın
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder={confirmText}
          />
        </div>
      )}
    </Modal>
  );
}

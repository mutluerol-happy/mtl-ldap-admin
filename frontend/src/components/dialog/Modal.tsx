// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Polish fix (Tur 8.5): useEffect dependency listesi `[open, onClose, closeOnEscape]`
// idi → onClose her render'da yeni instance olarak gelince useEffect re-run oluyor,
// 10ms sonra ilk focusable elementine focus atılıyor, kullanıcı input'a yazarken
// imleç kayboluyordu. Fix: deps'i [open]'a düşür, onClose + closeOnEscape'i ref ile
// yakala. Davranış aynı, focus stabil.

import { X } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: ModalSize;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  footer?: ReactNode;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[min(96vw,80rem)]",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  closeOnEscape = true,
  closeOnBackdrop = true,
  footer,
}: ModalProps) {
  const { t } = useTranslation("common");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Callback ve flag ref'leri — useEffect identity'sini bu prop'lara bağlamamak için
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  const closeOnBackdropRef = useRef(closeOnBackdrop);
  useEffect(() => {
    onCloseRef.current = onClose;
    closeOnEscapeRef.current = closeOnEscape;
    closeOnBackdropRef.current = closeOnBackdrop;
  });

  // ESC + body scroll lock + ilk focus — sadece açılış/kapanışta çalışır
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscapeRef.current) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // İlk focus — sadece açılışta bir kez. İçeride zaten focus varsa dokunma.
    const t = window.setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      if (root.contains(document.activeElement)) return;
      const focusable = root.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 10);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, [open]);

  if (!open) return null;

  const node = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[modal-fade_140ms_ease-out]"
        onClick={() => closeOnBackdropRef.current && onCloseRef.current()}
      />

      <div
        ref={dialogRef}
        className={[
          "relative w-full max-h-[90vh] flex flex-col",
          "rounded-lg border border-border bg-card text-fg shadow-xl",
          "animate-[modal-pop_160ms_cubic-bezier(.2,.9,.3,1.2)]",
          SIZE_CLASSES[size],
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-fg-subtle">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>

      <style>{`
        @keyframes modal-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes modal-pop {
          from { opacity: 0; transform: translateY(8px) scale(.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
}

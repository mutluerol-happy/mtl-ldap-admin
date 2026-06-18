// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";
import { Send } from "lucide-react";

import { Modal } from "@/components/dialog/Modal";
import { useSmtpTest } from "@/hooks/useSettings";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SmtpTestDialog({ open, onClose }: Props) {
  const { t } = useTranslation("common");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const testMut = useSmtpTest();

  useEffect(() => {
    if (open) {
      setEmail("");
      setError(null);
    }
  }, [open]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const submit = async () => {
    if (!valid) return;
    setError(null);
    try {
      await testMut.mutateAsync({ to_email: email });
      onClose();
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="SMTP Test Maili"
      description="Mevcut SMTP yapılandırması ile test maili gönder."
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={testMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || testMut.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {testMut.isPending ? "Gönderiliyor…" : "Gönder"}
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
            Alıcı e-posta adresi <span className="text-destructive">*</span>
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) submit();
            }}
            placeholder="test@example.com"
            autoFocus
            className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </label>
        <p className="text-xs text-fg-subtle">
          SMTP yapılandırması yetersizse (host, from_email vb. eksikse) gönderim
          hata mesajıyla iletilecektir.
        </p>
      </div>
    </Modal>
  );
}

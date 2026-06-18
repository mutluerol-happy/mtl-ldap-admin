// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";
import { Send } from "lucide-react";

import { Modal } from "@/components/dialog/Modal";
import { useSmsTest } from "@/hooks/useSettings";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SmsTestDialog({ open, onClose }: Props) {
  const { t } = useTranslation("common");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const testMut = useSmsTest();

  useEffect(() => {
    if (open) {
      setPhone("");
      setError(null);
      setResult(null);
    }
  }, [open]);

  // E.164 format veya boş (boşsa settings.test_to_number kullanılır)
  const valid = phone === "" || /^\+\d{8,15}$/.test(phone);

  const submit = async () => {
    if (!valid) return;
    setError(null);
    setResult(null);
    try {
      const res = await testMut.mutateAsync({
        to_number: phone || undefined,
      });
      if (res?.ok) {
        setResult(`✓ Başarılı (${res.provider}). ${res.body ?? ""}`);
      } else {
        setError(res?.error ?? "SMS gönderim başarısız");
      }
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="SMS Test"
      description="Mevcut SMS sağlayıcı yapılandırması ile test mesajı gönder."
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={testMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            Kapat
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
        {result && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-600 dark:text-emerald-400">
            {result}
          </div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-fg-subtle">
            Alıcı numara (boşsa <code>sms.test_to_number</code> ayarı kullanılır)
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) submit();
            }}
            placeholder="+905551234567"
            autoFocus
            className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </label>
        <p className="text-xs text-fg-subtle">
          Format: E.164 (örn. <code>+905551234567</code>). Mock provider ile
          gerçek SMS gönderilmez, sadece log yazılır.
        </p>
      </div>
    </Modal>
  );
}

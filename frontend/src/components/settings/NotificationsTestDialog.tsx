// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";
import { Send, MessageSquare, Hash, Globe } from "lucide-react";

import { Modal } from "@/components/dialog/Modal";
import { useNotificationsTest } from "@/hooks/useSettings";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Channel = "slack" | "teams" | "webhook";

export function NotificationsTestDialog({ open, onClose }: Props) {
  const { t } = useTranslation("common");
  const [channel, setChannel] = useState<Channel>("slack");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const testMut = useNotificationsTest();

  useEffect(() => {
    if (open) {
      setChannel("slack");
      setError(null);
      setResult(null);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    setResult(null);
    try {
      const res = await testMut.mutateAsync({ channel });
      if (res?.ok) {
        setResult(`✓ Başarılı (${res.channel}). ${res.body ?? ""}`);
      } else {
        setError(res?.error ?? "Bildirim gönderim başarısız");
      }
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  const channels: Array<{ id: Channel; label: string; icon: typeof MessageSquare; desc: string }> = [
    { id: "slack",   label: "Slack",            icon: Hash,           desc: "Incoming Webhook → kanala mesaj" },
    { id: "teams",   label: "Microsoft Teams",  icon: MessageSquare,  desc: "Adaptive Card mesaj" },
    { id: "webhook", label: "Generic Webhook",  icon: Globe,          desc: "POST JSON (kullanıcı tanımlı endpoint)" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bildirim Kanalı Test"
      description="Yapılandırılmış kanala test mesajı gönder."
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
            disabled={testMut.isPending}
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
        
        <div>
          <span className="mb-2 block text-xs uppercase tracking-wider text-fg-subtle">
            Kanal
          </span>
          <div className="space-y-2">
            {channels.map((ch) => {
              const Icon = ch.icon;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setChannel(ch.id)}
                  className={
                    "w-full flex items-start gap-3 rounded-md border p-3 text-left text-sm transition " +
                    (channel === ch.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-bg hover:border-fg-subtle")
                  }
                >
                  <Icon
                    className={
                      "h-4 w-4 mt-0.5 flex-shrink-0 " +
                      (channel === ch.id ? "text-primary" : "text-fg-subtle")
                    }
                  />
                  <div className="flex-1">
                    <div className={channel === ch.id ? "font-medium text-primary" : "text-fg"}>
                      {ch.label}
                    </div>
                    <div className="text-xs text-fg-subtle mt-0.5">{ch.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        
        <p className="text-xs text-fg-subtle">
          Seçilen kanal Settings'te <strong>devre dışı</strong> olsa bile test mesajı gönderilir
          (yapılandırma doğrulaması için).
        </p>
      </div>
    </Modal>
  );
}

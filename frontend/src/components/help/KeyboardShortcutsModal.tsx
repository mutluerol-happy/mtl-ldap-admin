// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect } from "react";
import { X, Command } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Section {
  title: string;
  rows: Array<{ keys: string[]; label: string }>;
}

const SECTIONS: Section[] = [
  {
    title: "Genel",
    rows: [
      { keys: ["Ctrl", "K"], label: "Komut paleti / arama" },
      { keys: ["?"], label: "Bu yardım penceresi" },
      { keys: ["Esc"], label: "Modal / palet kapat" },
    ],
  },
  {
    title: "Navigasyon (önce g)",
    rows: [
      { keys: ["g", "h"], label: "Panel (ana sayfa)" },
      { keys: ["g", "u"], label: "Kullanıcılar" },
      { keys: ["g", "a"], label: "Adminler" },
      { keys: ["g", "g"], label: "Gruplar" },
      { keys: ["g", "r"], label: "Roller" },
      { keys: ["g", "l"], label: "Audit (log)" },
      { keys: ["g", "n"], label: "Uyarılar" },
      { keys: ["g", "y"], label: "Senkron" },
      { keys: ["g", "c"], label: "Küme" },
      { keys: ["g", "s"], label: "Ayarlar" },
    ],
  },
];

export interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation("common");
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Command className="h-4 w-4 text-fg-subtle" />
            <h2 className="text-sm font-semibold text-fg">Klavye Kısayolları</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-subtle hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-5">
          {SECTIONS.map((sec) => (
            <div key={sec.title}>
              <div className="text-[10px] font-mono uppercase tracking-wider-2 text-fg-subtle mb-2">
                {sec.title}
              </div>
              <div className="space-y-1.5">
                {sec.rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between text-sm py-1"
                  >
                    <span className="text-fg-muted">{row.label}</span>
                    <div className="flex items-center gap-1">
                      {row.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <kbd className="font-mono text-[11px] text-fg bg-bg-elevated border border-border px-1.5 py-0.5 rounded min-w-[20px] text-center">
                            {k}
                          </kbd>
                          {i < row.keys.length - 1 && (
                            <span className="text-fg-subtle text-xs">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border px-5 py-2 text-[10px] font-mono uppercase tracking-wider-2 text-fg-subtle">
          MTL · ipucu: input alanlarında bu kısayollar tetiklenmez
        </div>
      </div>
    </div>
  );
}

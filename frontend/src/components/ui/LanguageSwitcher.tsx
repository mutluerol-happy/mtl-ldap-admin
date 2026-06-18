// SPDX-License-Identifier: Apache-2.0
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Languages } from "lucide-react";

const LANGS = [
  { code: "tr", label: "TR" },
  { code: "en", label: "EN" },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const current = i18n.resolvedLanguage || "tr";

  const handleChange = async (code: string) => {
    if (code === current) return;
    // ÖNCE localStorage'a yaz (axios interceptor bunu okuyor)
    localStorage.setItem("mtl-lang", code);
    await i18n.changeLanguage(code);
    // React Query cache'ini invalidate et — backend'den yeni dilde refetch
    await queryClient.invalidateQueries();
  };

  return (
    <div className="flex items-center gap-1.5">
      <Languages className="h-3.5 w-3.5 text-fg-subtle" />
      <div className="flex items-center bg-bg-elevated rounded border border-border overflow-hidden">
        {LANGS.map((l) => (
          <button
            key={l.code}
            onClick={() => handleChange(l.code)}
            className={
              "px-2 py-0.5 text-[11px] font-mono tracking-wide transition-colors " +
              (current === l.code
                ? "bg-amber text-bg"
                : "text-fg-muted hover:text-fg hover:bg-bg-hover")
            }
            aria-label={`Dil: ${l.label}`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

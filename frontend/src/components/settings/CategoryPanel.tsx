// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import {
  Bell,
  ChevronDown,
  ChevronUp,
  Database,
  KeyRound,
  Mail,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { SettingValueEditor } from "@/components/settings/SettingValueEditor";
import type { SettingsCategoryResponse } from "@/types/setting";

import { useTranslation } from "react-i18next";
// Kategori → ikon
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  password_policy: KeyRound,
  mfa_policy: ShieldCheck,
  audit_retention: Database,
  smtp: Mail,
  email_templates: Bell,
};

interface Props {
  category: SettingsCategoryResponse;
  defaultExpanded?: boolean;
  /** SMTP kategorisi için ekstra aksiyon butonu */
  extraAction?: React.ReactNode;
}

export function CategoryPanel({
  category,
  defaultExpanded = true,
  extraAction,
}: Props) {
  const { t, i18n } = useTranslation("settings");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = CATEGORY_ICONS[category.category] ?? Send;

  return (
    <div className="rounded-lg border border-border bg-card">
      <header
        className="flex items-center justify-between border-b border-border px-4 py-3"
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-start gap-3 text-left"
        >
          <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-fg-subtle" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-fg">{i18n.exists(`categories.${category.category}.title`) ? t(`categories.${category.category}.title`) : category.title}</h2>
            {(i18n.exists(`categories.${category.category}.description`) || category.description) && (
              <p className="text-xs text-fg-subtle">{i18n.exists(`categories.${category.category}.description`) ? t(`categories.${category.category}.description`) : category.description}</p>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 flex-shrink-0 text-fg-subtle" />
          ) : (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-fg-subtle" />
          )}
        </button>
        {extraAction && (
          <div className="ml-3 flex-shrink-0">{extraAction}</div>
        )}
      </header>

      {expanded && (
        <ul className="divide-y divide-border">
          {category.settings.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_2fr]">
                {/* Sol: anahtar + açıklama */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <code className="font-mono text-xs text-fg">{s.key}</code>
                    {s.is_sensitive && (
                      <span className="rounded bg-amber-500/10 px-1 py-0 text-[9px] font-medium text-amber-600">
                        HASSAS
                      </span>
                    )}
                    {!s.is_editable && (
                      <span className="rounded bg-fg-subtle/10 px-1 py-0 text-[9px] text-fg-subtle">
                        SADECE-OKU
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <p className="mt-0.5 text-[11px] text-fg-subtle">
                      {s.description}
                    </p>
                  )}
                </div>
                {/* Sağ: değer + editor */}
                <div className="min-w-0">
                  <SettingValueEditor setting={s} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Tek bir ayar için inline editor. Tip bazlı render:
//   - boolean → toggle
//   - integer → number input (debounced save on blur/Enter)
//   - string  → text/textarea (uzun değerler için textarea)
//   - json    → textarea + JSON parse
// Hassas alanlar:
//   - Default: gizli, "Değiştir" butonuyla input açılır
//   - Yeni değer girilince Kaydet → temizlenir, tekrar "***" görünür

import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { useUpdateSetting } from "@/hooks/useSettings";
import type { SystemSettingItem } from "@/types/setting";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

interface Props {
  setting: SystemSettingItem;
}

export function SettingValueEditor({ setting }: Props) {
  const { t } = useTranslation("common");
  const updateMut = useUpdateSetting(setting.category, setting.key);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(toEditableString(setting));
  const [showSensitive, setShowSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Setting değişirse draft'ı senkronize et (PATCH sonrası refresh için)
  useEffect(() => {
    if (!editing) {
      setDraft(toEditableString(setting));
    }
  }, [setting, editing]);

  // Edit moduna girince focus
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  const isMultiline =
    setting.value_type === "json" ||
    (setting.value_type === "string" &&
      typeof setting.value === "string" &&
      setting.value.length > 80);

  // ---------- Submit ----------
  const submit = async () => {
    setError(null);
    let parsedValue: unknown;
    try {
      parsedValue = parseFromString(draft, setting.value_type);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Değer parse edilemedi");
      return;
    }

    try {
      await updateMut.mutateAsync({ value: parsedValue });
      setEditing(false);
      setShowSensitive(false);
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  const cancel = () => {
    setDraft(toEditableString(setting));
    setEditing(false);
    setShowSensitive(false);
    setError(null);
  };

  const resetToDefault = async () => {
    if (setting.default_value === null || setting.default_value === undefined) {
      toast.error("Varsayılan değer yok");
      return;
    }
    try {
      const parsed = parseFromString(setting.default_value, setting.value_type);
      await updateMut.mutateAsync({ value: parsed });
      setEditing(false);
    } catch (e) {
      toast.error(extractBackendError(e));
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isMultiline) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  // ---------- Display mode ----------
  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {renderDisplayValue(setting)}
        </div>
        <div className="flex flex-shrink-0 gap-1">
          {setting.is_editable && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
              title="Düzenle"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {setting.is_editable &&
            setting.default_value !== null &&
            setting.default_value !== undefined && (
              <button
                type="button"
                onClick={resetToDefault}
                disabled={updateMut.isPending}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-50"
                title={`Varsayılana sıfırla (${setting.default_value})`}
              >
                {updateMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
              </button>
            )}
        </div>
      </div>
    );
  }

  // ---------- Edit mode ----------
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {setting.value_type === "boolean" ? (
            // Boolean: select (true/false dropdown)
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              className="block w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : isMultiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              rows={5}
              className="block w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder={setting.default_value ?? ""}
            />
          ) : (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                type={
                  setting.is_sensitive && !showSensitive
                    ? "password"
                    : setting.value_type === "integer"
                      ? "number"
                      : "text"
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                className="block w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder={setting.default_value ?? ""}
              />
              {setting.is_sensitive && (
                <button
                  type="button"
                  onClick={() => setShowSensitive((v) => !v)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
                  title={showSensitive ? "Gizle" : "Göster"}
                >
                  {showSensitive ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 gap-1">
          <button
            type="button"
            onClick={submit}
            disabled={updateMut.isPending}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
            title="Kaydet (Enter)"
          >
            {updateMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={updateMut.isPending}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-50"
            title="Vazgeç (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}
      {setting.value_type === "integer" && (
        <div className="text-[10px] text-fg-subtle">
          ⏎ Kaydet · Esc Vazgeç
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================
function toEditableString(s: SystemSettingItem): string {
  // Edit moduna ilk girişte ne göstereceğiz?
  if (s.is_sensitive) {
    // Hassas: input başlangıçta boş, kullanıcı yeni değer girer
    return "";
  }
  const v = s.value;
  if (v === null || v === undefined) {
    return s.default_value ?? "";
  }
  if (s.value_type === "boolean") {
    return v ? "true" : "false";
  }
  if (s.value_type === "json") {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function parseFromString(raw: string, valueType: string): unknown {
  const trimmed = raw.trim();
  if (valueType === "integer") {
    if (trimmed === "") {
      throw new Error("Empty value not allowed");
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error("Geçerli bir tam sayı girin");
    }
    return n;
  }
  if (valueType === "boolean") {
    return trimmed === "true" || trimmed === "1";
  }
  if (valueType === "json") {
    if (trimmed === "") return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("Geçersiz JSON");
    }
  }
  // string
  return raw; // trim etmiyoruz — şifreler ve şablonlar etrafındaki space önemli olabilir
}

function renderDisplayValue(s: SystemSettingItem): React.ReactNode {
  const v = s.value;

  if (s.is_sensitive) {
    return s.is_set ? (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-mono text-xs text-fg">
        ●●●●●●●●
      </span>
    ) : (
      <span className="text-xs italic text-fg-subtle">Ayarlanmamış</span>
    );
  }

  if (v === null || v === undefined || v === "") {
    return (
      <span className="text-xs italic text-fg-subtle">
        {s.default_value ? `varsayılan: ${s.default_value}` : "boş"}
      </span>
    );
  }

  if (s.value_type === "boolean") {
    return v ? (
      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
        Aktif
      </span>
    ) : (
      <span className="inline-flex items-center rounded-full bg-fg-subtle/10 px-2 py-0.5 text-xs text-fg-subtle">
        Pasif
      </span>
    );
  }

  if (s.value_type === "json") {
    return (
      <pre className="max-w-xs overflow-x-auto rounded bg-muted/40 p-1 text-[10px]">
        {JSON.stringify(v, null, 2)}
      </pre>
    );
  }

  const str = String(v);
  if (str.length > 80) {
    return (
      <div className="max-w-md truncate font-mono text-xs text-fg" title={str}>
        {str}
      </div>
    );
  }

  return <span className="font-mono text-xs text-fg">{str}</span>;
}

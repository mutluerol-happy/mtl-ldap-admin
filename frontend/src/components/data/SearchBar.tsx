// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Search, X } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useTranslation } from "react-i18next";

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Local state ile çalışan debounce'lu arama kutusu.
 * Kullanıcı yazdıkça anında ekrana yansır, parent state `debounceMs` sonra güncellenir.
 */
export function SearchBar({
  value,
  onChange,
  placeholder = "Ara…",
  debounceMs = 300,
  autoFocus,
  className = "",
}: SearchBarProps) {
  const { t } = useTranslation("common");
  const [local, setLocal] = useState(value);
  const debounced = useDebouncedValue(local, debounceMs);

  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // External reset (örn. clear filters): parent value değişirse local'i de güncelle
  useEffect(() => {
    if (value !== local && document.activeElement?.tagName !== "INPUT") {
      setLocal(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div
      className={[
        "relative inline-flex items-center w-full sm:w-80",
        className,
      ].join(" ")}
    >
      <Search className="pointer-events-none absolute left-3 h-4 w-4 text-fg-subtle" />
      <input
        type="search"
        value={local}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setLocal(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="h-9 w-full rounded-md border border-border bg-bg pl-9 pr-9 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      {local && (
        <button
          type="button"
          aria-label="Temizle"
          onClick={() => setLocal("")}
          className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-muted hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

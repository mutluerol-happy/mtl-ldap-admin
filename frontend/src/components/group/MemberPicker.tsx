// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { Search, UserPlus, UserCheck } from "lucide-react";
import { Modal } from "@/components/dialog/Modal";
import { useUsersList } from "@/hooks/useUsers";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { uidFromDn } from "@/types/group";
import { useTranslation } from "react-i18next";

export interface MemberPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (uid: string) => void | Promise<void>;
  /** Mevcut üye DN'leri (member_dns). UID'ler içeriden parse edilir. */
  existingMemberDns: string[];
  title?: string;
}

export function MemberPicker({
  open,
  onClose,
  onSelect,
  existingMemberDns,
  title,
}: MemberPickerProps) {
  const { t } = useTranslation(["groups", "common"]);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const [adding, setAdding] = useState<string | null>(null);

  const { data, isLoading } = useUsersList({
    page: 1,
    page_size: 25,
    search: debounced || undefined,
  });

  const memberUidSet = new Set(
    existingMemberDns
      // groupOfNames -> DN'den uid parse; posixGroup -> deger zaten uid (memberUid)
      .map((m) => uidFromDn(m) ?? m)
      .filter((u): u is string => !!u),
  );

  const handleAdd = async (uid: string) => {
    if (memberUidSet.has(uid) || adding) return;
    try {
      setAdding(uid);
      await onSelect(uid);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="UID, isim veya e-posta ile ara…"
            className="h-9 w-full rounded-md border border-border bg-bg pl-9 pr-3 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div className="max-h-96 overflow-y-auto rounded-md border border-border">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-fg-subtle">
              {t("common:loading")}
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-12 text-center text-sm text-fg-subtle">
              {debounced ? t("common:queryStatus.loadingMatching") : t("common:queryStatus.loadingPrompt")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.items.map((u) => {
                const isMember = memberUidSet.has(u.uid);
                const isAdding = adding === u.uid;
                return (
                  <li
                    key={u.uid}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-sm text-fg">
                        {u.uid}
                      </div>
                      <div className="truncate text-xs text-fg-subtle">
                        {u.cn || "—"}
                        {u.email && ` · ${u.email}`}
                      </div>
                    </div>

                    {isMember ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs text-fg-subtle">
                        <UserCheck className="h-3.5 w-3.5" /> {t("groups:detail.members")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!!adding}
                        onClick={() => handleAdd(u.uid)}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {isAdding ? "Ekleniyor…" : "Ekle"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {data && data.total > data.items.length && (
          <div className="text-xs text-fg-subtle">
            {data.items.length.toLocaleString("tr-TR")} /{" "}
            {data.total.toLocaleString("tr-TR")} sonuç gösteriliyor — daha
            spesifik arayın.
          </div>
        )}
      </div>
    </Modal>
  );
}

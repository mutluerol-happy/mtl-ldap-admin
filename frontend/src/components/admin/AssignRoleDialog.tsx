// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { ShieldCheck, Shield } from "lucide-react";
import { Modal } from "@/components/dialog/Modal";
import { useRolesList } from "@/hooks/useRoles";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export interface AssignRoleDialogProps {
  open: boolean;
  onClose: () => void;
  onAssign: (roleName: string) => Promise<void>;
  /** Admin'in mevcut rolleri — bunlar grayed out. */
  currentRoleNames: string[];
}

export function AssignRoleDialog({
  open,
  onClose,
  onAssign,
  currentRoleNames,
}: AssignRoleDialogProps) {
  const { t } = useTranslation(["admins", "common"]);
  const { data, isLoading } = useRolesList();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (roleName: string) => {
    setPending(roleName);
    setError(null);
    try {
      await onAssign(roleName);
      onClose();
    } catch (e) {
      setError(extractBackendError(e));
    } finally {
      setPending(null);
    }
  };

  const currentSet = new Set(currentRoleNames);

  return (
    <Modal open={open} onClose={onClose} title="Rol Ata" size="md">
      <div className="space-y-3">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="py-8 text-center text-sm text-fg-subtle">
            Roller yükleniyor…
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-8 text-center text-sm text-fg-subtle">
            Rol bulunamadı.
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {data.items.map((r) => {
              const isSuper =
                r.name === "mtl.super_admin" || r.name === "super_admin";
              const Icon = isSuper ? ShieldCheck : Shield;
              const alreadyHas = currentSet.has(r.name);
              const isPending = pending === r.name;
              return (
                <li
                  key={r.id}
                  className={[
                    "flex items-start gap-3 px-3 py-2",
                    alreadyHas ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <Icon
                    className={[
                      "mt-0.5 h-4 w-4 flex-shrink-0",
                      isSuper ? "text-primary" : "text-fg-subtle",
                    ].join(" ")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm text-fg">
                      {r.name}
                    </div>
                    {r.description && (
                      <div className="truncate text-xs text-fg-subtle">
                        {r.description}
                      </div>
                    )}
                    <div className="mt-0.5 inline-flex items-center gap-1.5 text-[10px] text-fg-subtle">
                      <span className="font-mono">{r.permission_count} {t("admins:form.permissions")}</span>
                      {r.requires_mfa && (
                        <span className="rounded bg-amber-500/10 px-1 text-amber-600">
                          {t("admins:form.mfaRequired")}
                        </span>
                      )}
                      {r.is_system && (
                        <span className="rounded bg-fg-subtle/10 px-1">
                          {t("admins:form.system")}
                        </span>
                      )}
                    </div>
                  </div>
                  {alreadyHas ? (
                    <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-fg-subtle">
                      {t("assigned")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => handle(r.name)}
                      className="inline-flex h-7 items-center rounded-md bg-primary px-2 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isPending ? t("assigning") : t("assign")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

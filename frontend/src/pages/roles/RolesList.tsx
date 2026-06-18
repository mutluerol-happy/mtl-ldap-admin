// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Link } from "react-router-dom";
import { Shield, ShieldCheck, Lock } from "lucide-react";

import { useRolesList } from "@/hooks/useRoles";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function RolesList() {
  const { t } = useTranslation("roles");

  const { data, isLoading, isError, error } = useRolesList();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-fg">{t("title")}</h1>
        <p className="text-sm text-fg-subtle">
          {t("subtitle")}
        </p>
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t("loadError")}: {extractBackendError(error)}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-fg-subtle">
          Henüz rol tanımlanmamış.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((r) => {
            const isSuper =
              r.name === "mtl.super_admin" || r.name === "super_admin";
            const Icon = isSuper ? ShieldCheck : Shield;
            return (
              <Link
                key={r.id}
                to={`/roles/${encodeURIComponent(r.name)}`}
                className="block rounded-lg border border-border bg-card p-4 transition hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={[
                      "mt-0.5 h-5 w-5 flex-shrink-0",
                      isSuper ? "text-primary" : "text-fg-subtle",
                    ].join(" ")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="font-mono text-sm font-medium text-fg">
                        {r.name}
                      </div>
                      {r.is_system && (
                        <span className="rounded bg-fg-subtle/10 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                          {t("system")}
                        </span>
                      )}
                      {r.requires_mfa && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
                          <Lock className="h-2.5 w-2.5" />
                          MFA
                        </span>
                      )}
                    </div>
                    {r.description && (
                      <p className="mt-1 text-xs text-fg-subtle">
                        {r.description}
                      </p>
                    )}
                    <div className="mt-2 inline-flex items-center gap-1 text-xs">
                      <span className="font-mono text-fg">
                        {r.permission_count}
                      </span>
                      <span className="text-fg-subtle">{t("permissions")}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Shield, ShieldCheck, Lock } from "lucide-react";

import { useRole, usePermissionsGrouped } from "@/hooks/useRoles";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function RoleDetail() {
  const { name = "" } = useParams<{ name: string }>();
  const { t } = useTranslation("roles");
  const navigate = useNavigate();

  const { data: role, isLoading, isError, error } = useRole(name);
  const { data: groupedPerms } = usePermissionsGrouped();

  // Bu role'ün hangi permission'lara sahip olduğunu modülelere göre grupla
  const sections = useMemo(() => {
    if (!role || !groupedPerms) return [];
    const ownedSet = new Set(role.permissions);
    return groupedPerms.map((group) => ({
      module: group.module,
      permissions: group.permissions.map((p) => ({
        ...p,
        owned: ownedSet.has(p.code) || ownedSet.has("*"),
      })),
    }));
  }, [role, groupedPerms]);

  const hasWildcard = role?.permissions.includes("*");

  if (isLoading) {
    return <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>;
  }
  if (isError || !role) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Rol yüklenemedi: {extractBackendError(error)}
      </div>
    );
  }

  const isSuper =
    role.name === "mtl.super_admin" || role.name === "super_admin";
  const Icon = isSuper ? ShieldCheck : Shield;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => navigate("/roles")}
          aria-label={t("detail.back")}
          className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Icon
              className={[
                "h-5 w-5",
                isSuper ? "text-primary" : "text-fg-subtle",
              ].join(" ")}
            />
            <h1 className="font-mono text-xl font-semibold text-fg">
              {role.name}
            </h1>
            {role.is_system && (
              <span className="rounded bg-fg-subtle/10 px-1.5 py-0.5 text-xs text-fg-subtle">
                sistem
              </span>
            )}
            {role.requires_mfa && (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600">
                <Lock className="h-3 w-3" />
                MFA gerek
              </span>
            )}
          </div>
          {role.description && (
            <p className="mt-1 text-sm text-fg-subtle">{role.description}</p>
          )}
          <p className="mt-1 text-xs text-fg-subtle">
            <span className="font-mono">{role.permission_count}</span> yetki
            {hasWildcard && (
              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary">
                wildcard *
              </span>
            )}
          </p>
        </div>
      </div>

      {hasWildcard && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-fg">
          Bu rol <span className="font-mono">*</span> wildcard yetkisine sahip
          — sistemin tüm yetkilerini içerir. Aşağıdaki permission listesi
          referans amaçlıdır.
        </div>
      )}

      <div className="space-y-3">
        {sections.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-fg-subtle">
            Permission listesi yüklenemedi.
          </div>
        ) : (
          sections.map((section) => {
            const ownedCount = section.permissions.filter((p) => p.owned).length;
            if (ownedCount === 0 && !hasWildcard) return null;
            return (
              <div
                key={section.module}
                className="rounded-lg border border-border bg-card"
              >
                <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-fg">
                    {section.module}
                  </h2>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-subtle">
                    {ownedCount} / {section.permissions.length}
                  </span>
                </header>
                <ul className="divide-y divide-border">
                  {section.permissions
                    .filter((p) => p.owned || hasWildcard)
                    .map((p) => (
                      <li
                        key={p.code}
                        className="flex items-start gap-3 px-4 py-2"
                      >
                        <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs text-fg">
                            {p.code}
                          </div>
                          {p.description && (
                            <div className="text-xs text-fg-subtle">
                              {p.description}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

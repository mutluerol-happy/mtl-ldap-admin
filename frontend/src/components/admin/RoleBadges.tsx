// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Link } from "react-router-dom";
import { Shield, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Bir admin'in rollerini badge listesi olarak gösterir. */
export function RoleBadges({
  roles,
  linkable = false,
  size = "sm",
}: {
  roles: string[];
  linkable?: boolean;
  size?: "xs" | "sm";
}) {
  const { t } = useTranslation("common");
  if (!roles || roles.length === 0) {
    return <span className="text-xs italic text-fg-subtle">Rol yok</span>;
  }
  const sizeCls =
    size === "xs"
      ? "text-[10px] px-1.5 py-0 gap-1"
      : "text-xs px-2 py-0.5 gap-1";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {roles.map((r) => {
        const isSuper = r === "mtl.super_admin" || r === "super_admin";
        const Icon = isSuper ? ShieldCheck : Shield;
        const tone = isSuper
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-muted text-fg border-border";
        const inner = (
          <span
            className={[
              "inline-flex items-center rounded-full border font-mono",
              sizeCls,
              tone,
            ].join(" ")}
          >
            <Icon className="h-3 w-3" />
            {r}
          </span>
        );
        return linkable ? (
          <Link
            key={r}
            to={`/roles/${encodeURIComponent(r)}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            {inner}
          </Link>
        ) : (
          <span key={r}>{inner}</span>
        );
      })}
    </div>
  );
}

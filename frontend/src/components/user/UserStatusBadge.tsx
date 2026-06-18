// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import type { User, UserStatusUI } from "@/types/user";
import { computeUserStatus } from "@/types/user";
import { useTranslation } from "react-i18next";

const META: Record<
  UserStatusUI,
  { label: string; tone: string; dot: string }
> = {
  active: {
    label: "status.active",
    tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    dot: "bg-emerald-500",
  },
  disabled: {
    label: "status.disabled",
    tone: "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30",
    dot: "bg-fg-subtle",
  },
  locked: {
    label: "status.locked",
    tone: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    dot: "bg-amber-500",
  },
};

export function UserStatusBadge({
  user,
  status,
}: {
  user?: User;
  status?: UserStatusUI;
}) {
  const { t } = useTranslation("users");
  const s: UserStatusUI = status ?? (user ? computeUserStatus(user) : "active");
  const m = META[s];
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        m.tone,
      ].join(" ")}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {t(m.label)}
    </span>
  );
}

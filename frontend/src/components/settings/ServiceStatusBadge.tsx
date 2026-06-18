// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Activity, AlertOctagon, CircleOff, HelpCircle, type LucideIcon } from "lucide-react";

const META: Record<
  string,
  { label: string; tone: string; Icon: LucideIcon }
> = {
  active: {
    label: "active",
    tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    Icon: Activity,
  },
  inactive: {
    label: "inactive",
    tone: "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30",
    Icon: CircleOff,
  },
  failed: {
    label: "failed",
    tone: "bg-red-500/10 text-red-600 border-red-500/30",
    Icon: AlertOctagon,
  },
  activating: {
    label: "activating",
    tone: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    Icon: Activity,
  },
  unknown: {
    label: "unknown",
    tone: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    Icon: HelpCircle,
  },
};

export function ServiceStatusBadge({ status }: { status: string }) {
  const meta = META[status?.toLowerCase()] ?? META.unknown;
  const Icon = meta.Icon;
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium font-mono",
        meta.tone,
      ].join(" ")}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

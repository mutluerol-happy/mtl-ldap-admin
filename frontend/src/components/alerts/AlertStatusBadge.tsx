// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  AlertOctagon,
  CheckCircle2,
  CircleDot,
  EyeOff,
  type LucideIcon,
} from "lucide-react";

const META: Record<
  string,
  { label: string; tone: string; Icon: LucideIcon }
> = {
  open: {
    label: "common:alertStatus.open",
    tone: "bg-red-500/10 text-red-600 border-red-500/30",
    Icon: AlertOctagon,
  },
  acknowledged: {
    label: "common:alertStatus.acknowledged",
    tone: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    Icon: CircleDot,
  },
  resolved: {
    label: "common:alertStatus.resolved",
    tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    Icon: CheckCircle2,
  },
  suppressed: {
    label: "common:alertStatus.suppressed",
    tone: "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30",
    Icon: EyeOff,
  },
};

const UNKNOWN = {
  label: "?",
  tone: "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30",
  Icon: CircleDot as LucideIcon,
};

export function AlertStatusBadge({
  status,
  size = "sm",
}: {
  status: string;
  size?: "xs" | "sm";
}) {
  const meta = META[status?.toLowerCase()] ?? UNKNOWN;
  const Icon = meta.Icon;
  const sizeCls =
    size === "xs"
      ? "text-[10px] px-1.5 py-0 gap-0.5"
      : "text-xs px-2 py-0.5 gap-1";
  const iconCls = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border font-medium",
        sizeCls,
        meta.tone,
      ].join(" ")}
    >
      <Icon className={iconCls} />
      {meta.label}
    </span>
  );
}

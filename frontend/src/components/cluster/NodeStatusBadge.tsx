// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  Circle,
  CircleDot,
  CircleOff,
  Loader2,
  type LucideIcon,
} from "lucide-react";

const META: Record<
  string,
  { label: string; tone: string; Icon: LucideIcon; animate?: boolean }
> = {
  online: {
    label: "Online",
    tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    Icon: CircleDot,
  },
  offline: {
    label: "Offline",
    tone: "bg-red-500/10 text-red-600 border-red-500/30",
    Icon: CircleOff,
  },
  degraded: {
    label: "Degraded",
    tone: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    Icon: Circle,
  },
  syncing: {
    label: "Syncing",
    tone: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    Icon: Loader2,
    animate: true,
  },
};

const UNKNOWN = {
  label: "?",
  tone: "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30",
  Icon: Circle as LucideIcon,
};

export function NodeStatusBadge({
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
  const iconCls = [
    size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3",
    (meta as any).animate ? "animate-spin" : "",
  ].join(" ");
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

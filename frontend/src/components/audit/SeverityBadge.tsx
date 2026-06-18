// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { AlertCircle, AlertTriangle, Info, Bell, Zap } from "lucide-react";
import { ReactNode } from "react";

const META: Record<
  string,
  { label: string; tone: string; Icon: typeof Info }
> = {
  INFO: {
    label: "INFO",
    tone: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    Icon: Info,
  },
  NOTICE: {
    label: "NOTICE",
    tone: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    Icon: Bell,
  },
  WARNING: {
    label: "WARNING",
    tone: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    Icon: AlertTriangle,
  },
  ERROR: {
    label: "ERROR",
    tone: "bg-orange-500/10 text-orange-600 border-orange-500/30",
    Icon: AlertCircle,
  },
  CRITICAL: {
    label: "CRITICAL",
    tone: "bg-red-500/10 text-red-600 border-red-500/30",
    Icon: Zap,
  },
};

const UNKNOWN = {
  label: "?",
  tone: "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30",
  Icon: Info,
};

export function SeverityBadge({
  severity,
  size = "sm",
  withIcon = true,
}: {
  severity: string;
  size?: "xs" | "sm";
  withIcon?: boolean;
}): ReactNode {
  const meta = META[severity?.toUpperCase()] ?? UNKNOWN;
  const Icon = meta.Icon;
  const sizeCls =
    size === "xs"
      ? "text-[10px] px-1.5 py-0 gap-0.5"
      : "text-xs px-2 py-0.5 gap-1";
  const iconCls = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border font-mono font-medium uppercase tracking-wider",
        sizeCls,
        meta.tone,
      ].join(" ")}
    >
      {withIcon && <Icon className={iconCls} />}
      {meta.label}
    </span>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Clock,
  Skull,
  XOctagon,
  type LucideIcon,
} from "lucide-react";

const META: Record<
  string,
  { labelKey: string; tone: string; Icon: LucideIcon }
> = {
  pending: {
    labelKey: "queueStatus.pending",
    tone: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    Icon: Clock,
  },
  sent: {
    labelKey: "queueStatus.sent",
    tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    Icon: CheckCircle2,
  },
  failed: {
    labelKey: "queueStatus.failed",
    tone: "bg-red-500/10 text-red-600 border-red-500/30",
    Icon: XOctagon,
  },
  abandoned: {
    labelKey: "queueStatus.abandoned",
    tone: "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30",
    Icon: Skull,
  },
};

const UNKNOWN_TONE = "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30";

export function QueueStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("common");
  const key = status?.toLowerCase();
  const meta = META[key];
  const Icon = meta?.Icon ?? Clock;
  const label = meta ? t(meta.labelKey) : status || "?";
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        meta?.tone ?? UNKNOWN_TONE,
      ].join(" ")}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

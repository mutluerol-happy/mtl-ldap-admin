// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  Database,
  FolderTree,
  GitMerge,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

const META: Record<
  string,
  { label: string; tone: string; Icon: LucideIcon }
> = {
  ldap_only: {
    label: "Sadece LDAP'te",
    tone: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    Icon: FolderTree,
  },
  db_only: {
    label: "Sadece DB'de",
    tone: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    Icon: Database,
  },
  attribute_mismatch: {
    label: "common:discrepancyType.attributeMismatch",
    tone: "bg-orange-500/10 text-orange-600 border-orange-500/30",
    Icon: GitMerge,
  },
};

const UNKNOWN = {
  label: "?",
  tone: "bg-fg-subtle/10 text-fg-subtle border-fg-subtle/30",
  Icon: HelpCircle,
};

export function DiscrepancyTypeBadge({ type }: { type: string }) {
  const meta = META[type] ?? { ...UNKNOWN, label: type };
  const Icon = meta.Icon;
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        meta.tone,
      ].join(" ")}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

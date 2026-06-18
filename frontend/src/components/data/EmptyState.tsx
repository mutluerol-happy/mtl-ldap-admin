// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      {Icon && (
        <div className="rounded-full border border-border bg-muted/40 p-3 text-fg-subtle">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div className="text-base font-medium text-fg">{title}</div>
      {description && (
        <p className="max-w-sm text-sm text-fg-subtle">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

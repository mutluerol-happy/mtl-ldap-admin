// SPDX-License-Identifier: Apache-2.0
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "default"
  | "amber"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClass: Record<BadgeVariant, string> = {
  default: "border-border bg-bg-elevated text-fg",
  amber: "border-amber/40 bg-amber/10 text-amber",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  info: "border-accent/40 bg-accent/10 text-accent",
  muted: "border-border bg-bg-inset text-fg-muted",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
        "font-mono text-[0.7rem] uppercase tracking-wider-2",
        variantClass[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";

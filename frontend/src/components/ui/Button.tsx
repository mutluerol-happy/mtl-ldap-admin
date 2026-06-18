// SPDX-License-Identifier: Apache-2.0
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "outline";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-amber text-fg-inverse hover:bg-amber-glow active:bg-amber/90 disabled:bg-amber/40 disabled:text-fg-inverse/60 font-semibold",
  secondary:
    "bg-bg-elevated text-fg border border-border hover:bg-bg-surface hover:border-fg-subtle disabled:opacity-50",
  ghost:
    "bg-transparent text-fg-muted hover:bg-bg-surface hover:text-fg disabled:opacity-50",
  danger:
    "bg-danger text-white hover:bg-danger/90 active:bg-danger/80 disabled:opacity-50 font-semibold",
  outline:
    "bg-transparent text-fg border border-border hover:bg-bg-surface hover:border-amber disabled:opacity-50",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center rounded-md font-mono tracking-wide",
          "transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "disabled:cursor-not-allowed",
          variantClass[variant],
          sizeClass[size],
          className,
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

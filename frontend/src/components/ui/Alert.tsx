// SPDX-License-Identifier: Apache-2.0
import { forwardRef, type HTMLAttributes } from "react";
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

export type AlertVariant = "info" | "success" | "warning" | "danger";

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  icon?: boolean;
}

const variantConfig: Record<
  AlertVariant,
  { className: string; Icon: typeof Info }
> = {
  info: {
    className: "border-accent/40 bg-accent/5 text-accent",
    Icon: Info,
  },
  success: {
    className: "border-success/40 bg-success/5 text-success",
    Icon: CheckCircle2,
  },
  warning: {
    className: "border-warning/40 bg-warning/5 text-warning",
    Icon: AlertTriangle,
  },
  danger: {
    className: "border-danger/40 bg-danger/10 text-danger",
    Icon: AlertCircle,
  },
};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", title, icon = true, children, ...props }, ref) => {
    const { className: vClass, Icon } = variantConfig[variant];
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          "rounded-md border px-4 py-3",
          "flex gap-3 items-start",
          vClass,
          className,
        )}
        {...props}
      >
        {icon && <Icon className="h-4 w-4 mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          {title && (
            <div className="font-mono text-xs font-semibold uppercase tracking-wider-2 mb-1">
              {title}
            </div>
          )}
          <div className="text-sm text-fg leading-relaxed">{children}</div>
        </div>
      </div>
    );
  },
);
Alert.displayName = "Alert";

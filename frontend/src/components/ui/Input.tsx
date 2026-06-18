// SPDX-License-Identifier: Apache-2.0
import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  monospace?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, monospace, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border bg-bg-inset px-3 py-2 text-sm",
          "text-fg placeholder:text-fg-subtle",
          "transition-colors",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-inset focus-visible:border-amber/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          invalid
            ? "border-danger/60 focus-visible:ring-danger/60 focus-visible:border-danger"
            : "border-border",
          monospace && "font-mono tracking-wide",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

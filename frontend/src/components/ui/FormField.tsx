// SPDX-License-Identifier: Apache-2.0
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Label } from "./Label";

interface FormFieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error && (
        <p className="text-xs text-danger font-mono mt-1 flex items-start gap-1">
          <span className="text-amber">→</span>
          <span>{error}</span>
        </p>
      )}
      {!error && hint && (
        <p className="text-xs text-fg-subtle font-mono mt-1">{hint}</p>
      )}
    </div>
  );
}

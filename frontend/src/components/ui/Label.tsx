// SPDX-License-Identifier: Apache-2.0
import { forwardRef, type LabelHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "text-label inline-flex items-center gap-1",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className,
        )}
        {...props}
      >
        {children}
        {required && <span className="text-amber">*</span>}
      </label>
    );
  },
);
Label.displayName = "Label";

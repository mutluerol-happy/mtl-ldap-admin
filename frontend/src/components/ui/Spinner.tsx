// SPDX-License-Identifier: Apache-2.0
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClass = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-10 w-10",
};

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <Loader2
      className={cn("animate-spin text-fg-muted", sizeClass[size], className)}
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" className="text-amber" />
        <div className="font-mono text-xs uppercase tracking-wider-2 text-fg-muted">
          Yükleniyor...
        </div>
      </div>
    </div>
  );
}

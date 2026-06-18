// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Loader2 } from "lucide-react";

export function PageLoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[40vh] w-full">
      <div className="flex flex-col items-center gap-3 text-fg-subtle">
        <Loader2 className="h-6 w-6 animate-spin" />
        <div className="font-mono text-[10px] uppercase tracking-wider-2">
          yükleniyor...
        </div>
      </div>
    </div>
  );
}

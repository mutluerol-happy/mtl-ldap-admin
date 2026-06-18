// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export function useSessionPolicy() {
  return useQuery<{ idle_timeout_minutes: number }>({
    queryKey: ["session-policy"],
    queryFn: () => api.sessionPolicy(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

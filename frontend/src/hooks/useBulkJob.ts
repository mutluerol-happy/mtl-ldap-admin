// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { bulkApi } from "@/lib/api.tur7-additions";

export const bulkKeys = {
  all: ["bulk"] as const,
  jobs: () => [...bulkKeys.all, "jobs"] as const,
  job: (id: string) => [...bulkKeys.jobs(), id] as const,
};

/** 2 saniyede bir polled eder; tamamlanınca polling durur. */
export function useBulkJob(jobId: string | undefined) {
  return useQuery({
    queryKey: jobId ? bulkKeys.job(jobId) : ["bulk", "jobs", "__none__"],
    queryFn: () => bulkApi.job(jobId as string),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === "pending" || status === "running") return 2000;
      return false;
    },
  });
}

export function useImportUsersCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => bulkApi.importUsersCsv(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: bulkKeys.jobs() }),
  });
}

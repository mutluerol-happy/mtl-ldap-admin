// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export interface ListQueryParams {
  page?: number;
  page_size?: number;
  search?: string;
}

export type BulkJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "partial"
  | "cancelled";

export interface BulkImportJob {
  id: string;
  job_type: string;
  status: BulkJobStatus | string;
  total_records: number;
  processed_records: number;
  successful_records: number;
  failed_records: number;
  source_filename: string | null;
  source_format: string | null;
  result_summary: Record<string, unknown>;
  error_log: Array<Record<string, unknown>>;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

export function extractBackendError(err: unknown): string {
  const e = err as { response?: { data?: ApiErrorBody } };
  const body = e?.response?.data?.error;
  if (body?.message) {
    const details = body.details as { errors?: Array<{ field?: string; message?: string }> } | undefined;
    if (details?.errors && details.errors.length > 0) {
      return details.errors
        .map((er) => er.message)
        .filter(Boolean)
        .join("; ");
    }
    return body.message;
  }
  if (err instanceof Error) return err.message;
  return "Beklenmedik bir hata oluştu";
}

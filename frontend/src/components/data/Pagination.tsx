// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 200],
}: PaginationProps) {
  const { t } = useTranslation("common");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-fg-subtle">
        <span className="font-mono text-fg">{start.toLocaleString("tr-TR")}</span>
        {" – "}
        <span className="font-mono text-fg">{end.toLocaleString("tr-TR")}</span>
        {" / "}
        <span className="font-mono text-fg">{total.toLocaleString("tr-TR")}</span>
        {" "}{t("pagination.records")}
      </div>

      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-fg-subtle">
            <span>{t("pagination.pageSize")}</span>
            <select
              className="rounded-md border border-border bg-bg px-2 py-1 text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label={t("pagination.prevPage")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg text-fg transition disabled:opacity-40 enabled:hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="px-2 font-mono text-fg">
            {page} / {totalPages}
          </span>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label={t("pagination.nextPage")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg text-fg transition disabled:opacity-40 enabled:hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Fragment, ReactNode } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  /** Hücre değerini render eden fonksiyon. */
  cell: (row: T) => ReactNode;
  /** Sort key (varsa). Backend'in beklediği `sort` parametresi. */
  sortable?: string;
  /** Sağa hizalı (örn. sayısal) hücreler için. */
  align?: "left" | "right" | "center";
  width?: string;
  className?: string;
}

export interface DataTableSort {
  key: string;
  order: "asc" | "desc";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyState?: ReactNode;
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  onRowClick?: (row: T) => void;
  /** Satır altında genişletilmiş içerik. */
  expandedRowKey?: string | null;
  renderExpanded?: (row: T) => ReactNode;
  /** Yoğun (compact) varyant — admin listeleri için. */
  density?: "comfortable" | "compact";
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyState,
  sort,
  onSortChange,
  onRowClick,
  expandedRowKey,
  renderExpanded,
  density = "comfortable",
}: DataTableProps<T>) {
  const { t } = useTranslation("common");
  const rowPad = density === "compact" ? "py-2" : "py-3";

  const toggleSort = (col: DataTableColumn<T>) => {
    if (!col.sortable || !onSortChange) return;
    if (!sort || sort.key !== col.sortable) {
      onSortChange({ key: col.sortable, order: "asc" });
    } else if (sort.order === "asc") {
      onSortChange({ key: col.sortable, order: "desc" });
    } else {
      onSortChange(null);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {columns.map((col) => {
                const isSorted = sort?.key === col.sortable;
                const justify =
                  col.align === "right"
                    ? "justify-end"
                    : col.align === "center"
                    ? "justify-center"
                    : "justify-start";
                return (
                  <th
                    key={col.key}
                    style={col.width ? { width: col.width } : undefined}
                    className={[
                      "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle",
                      col.sortable ? "cursor-pointer select-none hover:text-fg" : "",
                      col.className ?? "",
                    ].join(" ")}
                    onClick={() => toggleSort(col)}
                  >
                    <span className={`flex items-center gap-1 ${justify}`}>
                      {col.header}
                      {col.sortable && (
                        <span className="inline-flex flex-col">
                          <ChevronUp
                            className={`h-3 w-3 ${
                              isSorted && sort?.order === "asc"
                                ? "text-fg"
                                : "text-fg-muted/40"
                            }`}
                          />
                          <ChevronDown
                            className={`-mt-1 h-3 w-3 ${
                              isSorted && sort?.order === "desc"
                                ? "text-fg"
                                : "text-fg-muted/40"
                            }`}
                          />
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && !loading ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-12 text-center">
                  {emptyState ?? (
                    <span className="text-fg-subtle">Kayıt bulunamadı.</span>
                  )}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const key = rowKey(row);
                const isExpanded = expandedRowKey === key;
                return (
                  <Fragment key={key}>
                    <tr
                      className={[
                        "border-b border-border last:border-b-0 transition-colors",
                        onRowClick
                          ? "cursor-pointer hover:bg-muted/40"
                          : "hover:bg-muted/20",
                      ].join(" ")}
                      onClick={() => onRowClick?.(row)}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={[
                            "px-3",
                            rowPad,
                            col.align === "right"
                              ? "text-right"
                              : col.align === "center"
                              ? "text-center"
                              : "text-left",
                            col.className ?? "",
                          ].join(" ")}
                        >
                          {col.cell(row)}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && renderExpanded && (
                      <tr className="border-b border-border bg-muted/20">
                        <td colSpan={columns.length} className="px-3 py-3">
                          {renderExpanded(row)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-[dt-progress_1.2s_ease-in-out_infinite] bg-primary" />
        </div>
      )}

      <style>{`
        @keyframes dt-progress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { Filter, X, ChevronDown, ChevronUp } from "lucide-react";

import type { AuditEventQuery } from "@/types/audit";
import { useAuditCategories, useAuditEventCodes, useAuditServerNodes } from "@/hooks/useAudit";
import { useTranslation } from "react-i18next";

const SEVERITY_OPTIONS = ["INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"];

export interface AuditFiltersProps {
  query: AuditEventQuery;
  onChange: (next: Partial<AuditEventQuery>) => void;
  onReset: () => void;
}

export function AuditFilters({
  query,
  onChange,
  onReset,
}: AuditFiltersProps) {
  const { t } = useTranslation(["audit", "common"]);
  const [expanded, setExpanded] = useState(false);
  const { data: categories } = useAuditCategories();
  const { data: eventCodes } = useAuditEventCodes();
  const { data: serverNodes } = useAuditServerNodes();

  // Aktif filtre sayısı (page/page_size hariç)
  const activeCount = [
    query.category,
    query.event_code,
    query.severity,
    query.actor_display,
    query.actor_id,
    query.target_id,
    query.ip_address,
    query.server_node,
    query.search,
    query.date_from,
    query.date_to,
  ].filter(Boolean).length;

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Top bar — daima görünür */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <input
          type="text"
          placeholder={t("filters.searchPlaceholder")}
          value={query.search ?? ""}
          onChange={(e) => onChange({ search: e.target.value || undefined })}
          className="flex-1 min-w-[200px] rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
        >
          <Filter className="h-4 w-4" />
          {t("filters.general")}
          {activeCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-mono text-white">
              {activeCount}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-bg px-3 text-sm text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <X className="h-4 w-4" />
            Temizle
          </button>
        )}
      </div>

      {/* Detay filtreler */}
      {expanded && (
        <div className="border-t border-border px-3 py-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Kategori">
              <select
                value={query.category ?? ""}
                onChange={(e) =>
                  onChange({ category: e.target.value || undefined })
                }
                className={selectCls}
              >
                <option value="">Hepsi</option>
                {(categories ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Event Kodu">
              <select
                value={query.event_code ?? ""}
                onChange={(e) =>
                  onChange({ event_code: e.target.value || undefined })
                }
                className={selectCls}
              >
                <option value="">Hepsi</option>
                {(eventCodes ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Severity">
              <select
                value={query.severity ?? ""}
                onChange={(e) =>
                  onChange({ severity: e.target.value || undefined })
                }
                className={selectCls}
              >
                <option value="">Hepsi</option>
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("filters.serverNode")}>
              <select
                value={query.server_node ?? ""}
                onChange={(e) =>
                  onChange({ server_node: e.target.value || undefined })
                }
                className={selectCls}
              >
                <option value="">Hepsi</option>
                {(serverNodes ?? []).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("filters.actor")}>
              <input
                type="text"
                value={query.actor_display ?? ""}
                onChange={(e) =>
                  onChange({ actor_display: e.target.value || undefined })
                }
                placeholder={t("filters.actorPlaceholder")}
                className={inputCls}
              />
            </Field>

            <Field label="Hedef ID">
              <input
                type="text"
                value={query.target_id ?? ""}
                onChange={(e) =>
                  onChange({ target_id: e.target.value || undefined })
                }
                placeholder="UUID veya username"
                className={inputCls}
              />
            </Field>

            <Field label="IP Adresi">
              <input
                type="text"
                value={query.ip_address ?? ""}
                onChange={(e) =>
                  onChange({ ip_address: e.target.value || undefined })
                }
                placeholder={t("filters.ipPlaceholder")}
                className={inputCls + " font-mono"}
              />
            </Field>

            <Field label={t("filters.dateStart")}>
              <input
                type="datetime-local"
                value={isoToLocalInput(query.date_from)}
                onChange={(e) =>
                  onChange({
                    date_from: localInputToIso(e.target.value) || undefined,
                  })
                }
                className={inputCls}
              />
            </Field>

            <Field label={t("filters.dateEnd")}>
              <input
                type="datetime-local"
                value={isoToLocalInput(query.date_to)}
                onChange={(e) =>
                  onChange({
                    date_to: localInputToIso(e.target.value) || undefined,
                  })
                }
                className={inputCls}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50";
const selectCls = inputCls;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}

// ISO ↔ datetime-local input dönüşümü
function isoToLocalInput(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function localInputToIso(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toISOString();
}

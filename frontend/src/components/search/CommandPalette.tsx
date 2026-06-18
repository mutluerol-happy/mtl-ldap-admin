// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Bell,
  Cog,
  Database,
  FileBox,
  FolderTree,
  Loader2,
  Search,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";

import { apiClient } from "@/lib/api";
import { useTranslation } from "react-i18next";

interface CommandItem {
  id: string;
  category: "sayfa" | "kullanıcı" | "admin" | "grup";
  label: string;
  description?: string;
  icon: ComponentType<{ className?: string }>;
  to: string;
}

const STATIC_PAGES: CommandItem[] = [
  { id: "p-dashboard", category: "sayfa", label: "Panel", description: "Ana sayfa", icon: Database, to: "/" },
  { id: "p-users", category: "sayfa", label: "Kullanıcılar", description: "LDAP kullanıcıları", icon: Users, to: "/users" },
  { id: "p-admins", category: "sayfa", label: "Adminler", description: "Yönetici hesapları", icon: Shield, to: "/admins" },
  { id: "p-groups", category: "sayfa", label: "Gruplar", description: "Kullanıcı grupları", icon: FolderTree, to: "/groups" },
  { id: "p-roles", category: "sayfa", label: "Roller", description: "RBAC rol yönetimi", icon: FileBox, to: "/roles" },
  { id: "p-audit", category: "sayfa", label: "Audit", description: "Denetim olayları", icon: Activity, to: "/audit" },
  { id: "p-alerts", category: "sayfa", label: "Uyarılar", description: "Aktif alarmlar", icon: Bell, to: "/alerts" },
  { id: "p-sync", category: "sayfa", label: "Senkron", description: "Replikasyon", icon: Cog, to: "/sync" },
  { id: "p-cluster", category: "sayfa", label: "Küme", description: "Cluster durumu", icon: Cog, to: "/cluster" },
  { id: "p-settings", category: "sayfa", label: "Ayarlar", description: "Sistem ayarları", icon: Settings, to: "/settings" },
];

const CATEGORY_LABEL: Record<CommandItem["category"], string> = {
  sayfa: "SAYFALAR",
  kullanıcı: "KULLANICILAR",
  admin: "ADMİNLER",
  grup: "GRUPLAR",
};

function fuzzyMatch(text: string, q: string): boolean {
  if (!q) return true;
  return text.toLowerCase().includes(q.toLowerCase());
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<CommandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setRemoteResults([]);
      setSelectedIdx(0);
    } else {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemoteResults([]);
      return;
    }
    setLoading(true);
    const handler = setTimeout(async () => {
      const collected: CommandItem[] = [];
      await Promise.allSettled([
        apiClient
          .get("/users", { params: { search: q, page_size: 6 } })
          .then((r) => {
            const items = r.data?.items ?? r.data?.users ?? r.data ?? [];
            for (const u of Array.isArray(items) ? items.slice(0, 6) : []) {
              collected.push({
                id: `u-${u.uid ?? u.id}`,
                category: "kullanıcı",
                label: u.uid ?? u.username ?? "?",
                description:
                  [u.display_name ?? u.cn, u.mail ?? u.email]
                    .filter(Boolean)
                    .join(" · ") || undefined,
                icon: Users,
                to: `/users/${u.uid ?? u.id}`,
              });
            }
          })
          .catch(() => undefined),
        apiClient
          .get("/admins", { params: { search: q, page_size: 6 } })
          .then((r) => {
            const items = r.data?.items ?? r.data?.admins ?? r.data ?? [];
            for (const a of Array.isArray(items) ? items.slice(0, 6) : []) {
              collected.push({
                id: `a-${a.id ?? a.username}`,
                category: "admin",
                label: a.username ?? "?",
                description:
                  [a.display_name, a.email].filter(Boolean).join(" · ") ||
                  undefined,
                icon: Shield,
                to: `/admins/${a.id ?? a.username}`,
              });
            }
          })
          .catch(() => undefined),
        apiClient
          .get("/groups", { params: { search: q, page_size: 6 } })
          .then((r) => {
            const items = r.data?.items ?? r.data?.groups ?? r.data ?? [];
            for (const g of Array.isArray(items) ? items.slice(0, 6) : []) {
              collected.push({
                id: `g-${g.cn ?? g.id}`,
                category: "grup",
                label: g.cn ?? g.name ?? "?",
                description: g.description ?? undefined,
                icon: FolderTree,
                to: `/groups/${g.cn ?? g.id}`,
              });
            }
          })
          .catch(() => undefined),
      ]);
      setRemoteResults(collected);
      setLoading(false);
    }, 220);
    return () => clearTimeout(handler);
  }, [query, open]);

  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim();
    const filteredPages = STATIC_PAGES.filter(
      (p) => fuzzyMatch(p.label, q) || fuzzyMatch(p.description ?? "", q),
    );
    return [...filteredPages, ...remoteResults];
  }, [query, remoteResults]);

  useEffect(() => {
    if (selectedIdx >= items.length) setSelectedIdx(0);
  }, [items.length, selectedIdx]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const item = items[selectedIdx];
        if (item) {
          e.preventDefault();
          navigate(item.to);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, items, selectedIdx, navigate, onClose]);

  if (!open) return null;

  const grouped = items.reduce<Record<string, CommandItem[]>>((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});
  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-fg-subtle shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sayfa ara veya kullanıcı/admin/grup adı yaz..."
            className="flex-1 bg-transparent border-0 outline-none text-sm text-fg placeholder:text-fg-subtle"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-fg-subtle" />}
          <kbd className="text-[10px] font-mono text-fg-subtle border border-border px-1.5 py-0.5 rounded">
            ESC
          </kbd>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-subtle hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-fg-subtle">
              {query.trim().length < 2
                ? "Yazmaya başlayın veya bir sayfa seçin..."
                : "Sonuç bulunamadı"}
            </div>
          ) : (
            (["sayfa", "kullanıcı", "admin", "grup"] as const).map((cat) => {
              const catItems = grouped[cat];
              if (!catItems?.length) return null;
              return (
                <div key={cat} className="mb-1">
                  <div className="px-4 py-1 text-[10px] font-mono uppercase tracking-wider-2 text-fg-subtle">
                    {CATEGORY_LABEL[cat]}
                  </div>
                  {catItems.map((item) => {
                    const isSel = flatIdx === selectedIdx;
                    const Icon = item.icon;
                    const myIdx = flatIdx++;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setSelectedIdx(myIdx)}
                        onClick={() => {
                          navigate(item.to);
                          onClose();
                        }}
                        className={
                          "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors " +
                          (isSel
                            ? "bg-amber/10 text-fg"
                            : "text-fg-muted hover:bg-bg-elevated hover:text-fg")
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0 text-fg-subtle" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {item.label}
                          </div>
                          {item.description && (
                            <div className="text-xs text-fg-subtle truncate">
                              {item.description}
                            </div>
                          )}
                        </div>
                        {isSel && (
                          <kbd className="text-[10px] font-mono text-fg-subtle">↵</kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div className="border-t border-border px-4 py-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider-2 text-fg-subtle">
          <div className="flex items-center gap-3">
            <span>↑↓ gezin</span>
            <span>↵ aç</span>
            <span>esc kapat</span>
          </div>
          <span>MTL Komut Paleti</span>
        </div>
      </div>
    </div>
  );
}

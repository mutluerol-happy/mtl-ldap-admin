// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
  Settings,
  User as UserIcon,
  Moon,
  Sun,
} from "lucide-react";

import { Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";


const PATH_TO_LABEL: Record<string, string> = {
  "/dashboard": "sidebar:items.dashboard",
  "/profile": "sidebar:items.profile",
  "/users": "sidebar:items.users",
  "/groups": "sidebar:items.groups",
  "/admins": "sidebar:items.admins",
  "/roles": "sidebar:items.roles",
  "/audit": "sidebar:items.audit",
  "/alerts": "sidebar:items.alerts",
  "/cluster": "sidebar:items.cluster",
  "/sync": "sidebar:items.sync",
  "/settings": "sidebar:items.settings",
  "/bulk": "users:bulkImport",
};

export function Header() {
  const location = useLocation();
  const pageLabelKey =
    Object.entries(PATH_TO_LABEL).find(([p]) =>
      location.pathname === p || location.pathname.startsWith(p + "/")
    )?.[1] || "sidebar:items.dashboard";
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const tokens = useAuthStore((s) => s.tokens);
  const clearSession = useAuthStore((s) => s.clearSession);
  const { t } = useTranslation(["common", "sidebar", "auth"]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("mtl-theme") as "dark" | "light") ?? "dark";
  });
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Tema değişimi
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("mtl-theme", theme);
  }, [theme]);

  // Dropdown outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = async () => {
    try {
      if (tokens?.refresh_token) {
        await api.logout(tokens.refresh_token);
      }
    } catch {
      // Sessizce yut — token'ı yerel olarak kaldıracağız
    }
    clearSession();
    navigate("/login", { replace: true });
  };

  const userInitial = user?.display_name?.[0] || user?.username?.[0] || "?";

  return (
    <header className="h-14 shrink-0 bg-bg-surface border-b border-border flex items-center justify-between px-6">
      {/* Sol: breadcrumb yer tutucusu — sayfa başlığı buradan akacak */}
      <div className="flex items-center gap-3">
        <span className="text-label">{t("sidebar:footer.console")} /</span>
        <span className="font-mono text-sm text-fg" id="page-title">
          {t(pageLabelKey)}
        </span>
      </div>

      {/* Sağ: tema, kullanıcı menüsü */}
      <div className="flex items-center gap-3">
        <LanguageSwitcher />

        <button
          type="button"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="p-2 rounded text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors"
          aria-label={t("common:actions.refresh")}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>

        {/* Kullanıcı dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className={cn(
              "flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded",
              "hover:bg-bg-elevated transition-colors",
              dropdownOpen && "bg-bg-elevated",
            )}
          >
            <div className="h-7 w-7 rounded-full bg-amber/20 border border-amber/40 flex items-center justify-center">
              <span className="font-mono text-xs font-bold text-amber uppercase">
                {userInitial}
              </span>
            </div>
            <div className="flex flex-col items-start leading-none">
              <span className="font-mono text-xs text-fg">
                {user?.username ?? "—"}
              </span>
              {user?.mfa_enabled && (
                <span className="text-[0.65rem] font-mono text-success mt-0.5">
                  MFA ●
                </span>
              )}
            </div>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-fg-subtle transition-transform",
                dropdownOpen && "rotate-180",
              )}
            />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-md border border-border bg-bg-elevated shadow-elevated overflow-hidden animate-slide-up">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-sm font-medium text-fg">
                  {user?.display_name ?? user?.username}
                </div>
                <div className="text-xs text-fg-muted mt-0.5 font-mono break-all">
                  {user?.email ?? "—"}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {user?.roles.slice(0, 3).map((r) => (
                    <Badge key={r.id} variant="amber">
                      {r.name}
                    </Badge>
                  ))}
                  {user && user.roles.length > 3 && (
                    <Badge variant="muted">+{user.roles.length - 3}</Badge>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  setDropdownOpen(false);
                  navigate("/profile");
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-fg-muted hover:bg-bg-surface hover:text-fg transition-colors"
              >
                <UserIcon className="h-4 w-4" />
                {t("sidebar:items.profile")}
              </button>

              <button
                onClick={() => {
                  setDropdownOpen(false);
                  navigate("/profile");
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-fg-muted hover:bg-bg-surface hover:text-fg transition-colors"
              >
                <Settings className="h-4 w-4" />
                {t("sidebar:items.settings")}
              </button>

              <div className="border-t border-border" />

              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-danger hover:bg-danger/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {t("auth:logout")} Yap
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

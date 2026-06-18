// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Login sonrası layout. Üstte kompakt header (marka + kullanıcı + çıkış),
// solda dar dikey menü, ortada içerik.

import { useState, useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  KeyRound,
  LogOut,
  Menu,
  ShieldCheck,
  User,
  X,
  type LucideIcon,
  Sun,
  Moon,
} from "lucide-react";
import { toast } from "sonner";

import { usePortalAuthStore } from "@/portal/lib/portalAuthStore";
import { portalApi } from "@/portal/lib/portalApi";
import { portalPath } from "@/portal/lib/portalRoutes";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
const MTL_PROFILE: "MASTER" | "SLAVE" =
  ((import.meta as any).env?.VITE_MTL_PROFILE as "MASTER" | "SLAVE" | undefined) ?? "MASTER";
const BRAND_NAME = MTL_PROFILE === "SLAVE" ? "MTL Ldap" : "MTL Ldap Admin";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}
const NAV_ITEMS: NavItem[] = [
  { to: portalPath(), label: "nav.overview", icon: Home },
  { to: portalPath("profile"), label: "nav.profile", icon: User },
  { to: portalPath("password"), label: "nav.password", icon: KeyRound },
  { to: portalPath("mfa"), label: "MFA", icon: ShieldCheck },
];

export function PortalLayout() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("mtl-theme") as "dark" | "light") ?? "dark";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("mtl-theme", theme);
  }, [theme]);

  const { t } = useTranslation("portal");
  const navigate = useNavigate();
  const location = useLocation();
  const user = usePortalAuthStore((s) => s.user);
  const clearSession = usePortalAuthStore((s) => s.clear);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await portalApi.logout();
    clearSession();
    toast.info(t("logoutToast"));
    navigate(portalPath("login"), { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      {/* Header */}
      <header className="h-14 border-b border-border bg-bg-surface flex items-center px-4">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="mr-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg lg:hidden"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        <Link to={portalPath()} className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded bg-amber flex items-center justify-center shrink-0">
            <span className="font-display text-fg-inverse text-sm font-extrabold">
              M
            </span>
          </div>
          <div className="flex flex-col leading-none min-w-0">
            <span className="mtl-mark text-sm truncate">{BRAND_NAME}</span>
            <span className="text-[0.65rem] font-mono uppercase text-fg-subtle tracking-wider-2 mt-0.5">
              {t("userPortal")}
            </span>
          </div>
        </Link>

        <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="p-2 rounded text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors"
            aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
                  <div className="text-sm text-fg text-right hidden sm:block">
            <div className="font-medium">{user?.display_name || user?.username}</div>
            {user?.username && user?.display_name && (
              <div className="text-xs text-fg-subtle">@{user.username}</div>
            )}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t("logout")}</span>
          </button>
        </div>      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={cn(
            "w-56 shrink-0 border-r border-border bg-bg-surface flex-col",
            "lg:flex",
            mobileOpen ? "fixed inset-y-14 left-0 z-30 flex" : "hidden",
          )}
        >
          <nav className="flex-1 overflow-y-auto py-4">
            <ul className="space-y-0.5 px-2">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === portalPath()}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
                        isActive
                          ? "bg-amber/10 text-amber font-medium"
                          : "text-fg-muted hover:bg-bg-elevated hover:text-fg",
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{t(item.label)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="border-t border-border px-4 py-3">
            <div className="text-[0.65rem] font-mono uppercase tracking-wider-2 text-fg-subtle">
              {t("userFooter")}
            </div>
            <div className="text-[0.65rem] font-mono text-fg-subtle mt-0.5">
              © {new Date().getFullYear()} Mutlu Erol
            </div>
          </div>
        </aside>

        {/* İçerik */}
        <main
          className="flex-1 overflow-y-auto p-4 sm:p-6"
          key={location.pathname}
        >
          <div className="mx-auto max-w-3xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

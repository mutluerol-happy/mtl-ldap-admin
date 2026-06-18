import { useState, useEffect } from "react";
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Login + reset için anonim layout. Sade kart, ortalanmış.

import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { Sun, Moon } from "lucide-react";
const MTL_PROFILE: "MASTER" | "SLAVE" =
  ((import.meta as any).env?.VITE_MTL_PROFILE as "MASTER" | "SLAVE" | undefined) ?? "MASTER";

const BRAND_NAME = MTL_PROFILE === "SLAVE" ? "MTL Ldap" : "MTL Ldap Admin";

export function PortalAuthLayout() {
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
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
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
      <div className="absolute inset-0 bg-dots opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-amber/5 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Marka */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded bg-amber flex items-center justify-center shadow-glow-amber">
              <span className="font-display text-fg-inverse text-lg font-extrabold">
                M
              </span>
            </div>
            <div className="flex flex-col items-start leading-none">
              <span className="mtl-mark text-xl">{BRAND_NAME}</span>
              <span className="text-xs font-mono uppercase tracking-wider-2 text-fg-subtle mt-1">
                {t("userPortal")}
              </span>
            </div>
          </div>
        </div>

        <div className="terminal-frame">
          <div className="p-6 sm:p-8">
            <Outlet />
          </div>
        </div>

        <div className="mt-6 text-center">
          <a
            href="/login"
            className="text-xs font-mono uppercase tracking-wider-2 text-fg-subtle hover:text-fg"
          >
            {t("login.adminLogin")}
          </a>
        </div>
      </div>
    </div>
  );
}

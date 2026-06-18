// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Polish v2:
//   - "MTL Console" → profile-aware: MASTER ise "MTL Ldap Admin", SLAVE ise "MTL Ldap"

import { NavLink } from "react-router-dom";
import {
  Lock,
  LayoutDashboard,
  Users,
  UsersRound,
  ShieldCheck,
  KeyRound,
  ScrollText,
  Siren,
  Server,
  GitCompareArrows,
  User,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/auth";
import { useTranslation } from "react-i18next";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "groups.general",
    items: [
      { to: "/", label: "items.dashboard", icon: LayoutDashboard },
      { to: "/profile", label: "items.profile", icon: User },
    ],
  },
  {
    title: "groups.directory",
    items: [
      { to: "/users", label: "items.users", icon: Users, permission: "user.read" },
      { to: "/groups", label: "items.groups", icon: UsersRound, permission: "group.read" },
    ],
  },
  {
    title: "groups.authorization",
    items: [
      { to: "/admins", label: "items.admins", icon: ShieldCheck, permission: "admin.read" },
      { to: "/roles", label: "items.roles", icon: KeyRound, permission: "role.read" },
    ],
  },
  {
    title: "groups.observation",
    items: [
      { to: "/audit", label: "items.audit", icon: ScrollText, permission: "audit.read" },
      { to: "/alerts", label: "items.alerts", icon: Siren, permission: "audit.read" },
      { to: "/cluster", label: "items.cluster", icon: Server, permission: "audit.read" },
      { to: "/sync", label: "items.sync", icon: GitCompareArrows, permission: "audit.read" },
    ],
  },
  {
    title: "groups.system",
    items: [
      { to: "/shield", label: "items.shield", icon: Lock, permission: "shield.cert.read" },
      { to: "/settings", label: "items.settings", icon: Settings, permission: "settings.read" },
    ],
  },
];

const MTL_PROFILE: "MASTER" | "SLAVE" =
  ((import.meta as any).env?.VITE_MTL_PROFILE as "MASTER" | "SLAVE" | undefined) ?? "MASTER";

const BRAND_NAME = MTL_PROFILE === "SLAVE" ? "MTL Ldap" : "MTL Ldap Admin";
const BRAND_SUBTITLE =
  MTL_PROFILE === "SLAVE" ? "Slave · v0.6" : "Master · v0.6";

export function Sidebar() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { t } = useTranslation("sidebar");
  const user = useAuthStore((s) => s.user);

  return (
    <aside className="w-60 shrink-0 bg-bg-surface border-r border-border flex flex-col">
      <div className="h-14 px-5 flex items-center border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded bg-amber flex items-center justify-center shrink-0">
            <span className="font-display text-fg-inverse text-sm font-extrabold">
              M
            </span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="mtl-mark text-sm">{BRAND_NAME}</span>
            <span className="text-[0.65rem] font-mono uppercase text-fg-subtle tracking-wider-2 mt-0.5">
              {BRAND_SUBTITLE}
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 space-y-6">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(
            (it) =>
              !it.permission ||
              hasPermission(it.permission) ||
              user?.roles.some((r) => r.name === "mtl.super_admin"),
          );
          if (!visibleItems.length) return null;
          return (
            <div key={t(group.title)}>
              <div className="text-label px-5 mb-2">{t(group.title)}</div>
              <ul className="space-y-0.5 px-2">
                {visibleItems.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 px-3 py-2 rounded text-sm",
                          "transition-colors",
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
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border px-5 py-3">
        <div className="text-[0.65rem] font-mono uppercase tracking-wider-2 text-fg-subtle">
          MTL Ldap Admin
        </div>
        <div className="text-[0.65rem] font-mono text-fg-subtle mt-0.5">
          © {new Date().getFullYear()} Mutlu Erol
        </div>
      </div>
    </aside>
  );
}

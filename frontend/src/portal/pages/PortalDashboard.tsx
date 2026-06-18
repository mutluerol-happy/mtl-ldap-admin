// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Link } from "react-router-dom";
import { KeyRound, ShieldCheck, ShieldOff, User } from "lucide-react";

import { usePortalAuthStore } from "@/portal/lib/portalAuthStore";
import { portalPath } from "@/portal/lib/portalRoutes";

import { useTranslation } from "react-i18next";
export default function PortalDashboard() {
  const { t } = useTranslation("portal");
  const user = usePortalAuthStore((s) => s.user);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">
          {t("dashboard.welcome", { name: user?.display_name || user?.username })}
        </h1>
        <p className="text-sm text-fg-subtle">
          {t("dashboard.subtitle")}
        </p>
      </div>

      {/* Hesap özet kartı */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle mb-3">
          {t("dashboard.accountInfo")}
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <DD label={t("dashboard.username")} value={user?.username ?? "—"} mono />
          <DD label={t("dashboard.displayName")} value={user?.display_name ?? "—"} />
          <DD label={t("fields.email")} value={user?.email ?? user?.mail ?? "—"} mono />
          <DD label={t("fields.phone")} value={user?.phone ?? "—"} mono />
          <DD
            label="MFA"
            value={
              user?.mfa_enabled ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t("mfa.activeBadge")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-600">
                  <ShieldOff className="h-3.5 w-3.5" />
                  {t("mfa.inactiveBadge")}
                </span>
              )
            }
          />
        </dl>
      </div>

      {/* Hızlı bağlantılar */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle mb-3">
          {t("dashboard.quickActions")}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <QuickLink
            to={portalPath("profile")}
            icon={User}
            title={t("dashboard.profileTitle")}
            description={t("dashboard.profileDesc")}
          />
          <QuickLink
            to={portalPath("password")}
            icon={KeyRound}
            title={t("dashboard.passwordTitle")}
            description={t("dashboard.passwordDesc")}
          />
          <QuickLink
            to={portalPath("mfa")}
            icon={ShieldCheck}
            title={user?.mfa_enabled ? t("dashboard.mfaTitle") : t("dashboard.mfaEnableTitle")}
            description={t("dashboard.mfaDesc")}
            highlight={!user?.mfa_enabled}
          />
        </div>
      </div>

      {!user?.mfa_enabled && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          <strong>{t("dashboard.mfaPrompt")}</strong> {t("dashboard.mfaPromptHint")} {t("dashboard.mfaBannerBody")}</div>
      )}
    </div>
  );
}

function DD({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </dt>
      <dd
        className={[
          "mt-0.5 text-fg",
          mono ? "font-mono text-xs" : "text-sm",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  description,
  highlight,
}: {
  to: string;
  icon: typeof User;
  title: string;
  description: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className={[
        "rounded-lg border bg-card p-4 transition hover:bg-muted/30",
        highlight ? "border-amber/50" : "border-border",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon
          className={[
            "h-4 w-4",
            highlight ? "text-amber" : "text-primary",
          ].join(" ")}
        />
        <h3 className="font-medium text-sm text-fg">{title}</h3>
      </div>
      <p className="text-xs text-fg-subtle">{description}</p>
    </Link>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { Info, RefreshCw, Send, Settings as SettingsIcon } from "lucide-react";

import { CategoryPanel } from "@/components/settings/CategoryPanel";
import { ServiceStatusBadge } from "@/components/settings/ServiceStatusBadge";
import { SmtpTestDialog } from "@/components/settings/SmtpTestDialog";
import { SmsTestDialog } from "@/components/settings/SmsTestDialog";
import { NotificationsTestDialog } from "@/components/settings/NotificationsTestDialog";
import { useSettings, useSystemInfo } from "@/hooks/useSettings";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const [smtpDialog, setSmtpDialog] = useState(false);
  const [smsDialog, setSmsDialog] = useState(false);
  const [notifDialog, setNotifDialog] = useState(false);
  const {
    data: settings,
    isLoading: settingsLoading,
    isError: settingsError,
    error: settingsErr,
    isFetching: settingsFetching,
    refetch: refetchSettings,
  } = useSettings();
  const { data: info, isFetching: infoFetching, refetch: refetchInfo } = useSystemInfo();

  const isFetching = settingsFetching || infoFetching;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-fg-subtle" />
          <div>
            <h1 className="text-xl font-semibold text-fg">{t("title")}</h1>
            <p className="text-sm text-fg-subtle">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            refetchSettings();
            refetchInfo();
          }}
          disabled={isFetching}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
          {t("refresh")}
        </button>
      </div>

      {settingsError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t("loadError")}: {extractBackendError(settingsErr)}
        </div>
      )}

      {/* Sistem bilgisi kartı */}
      {info && (
        <div className="rounded-lg border border-border bg-card">
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Info className="h-4 w-4 text-fg-subtle" />
            <h2 className="text-sm font-semibold text-fg">{t("systemInfo.title")}</h2>
          </header>
          <div className="grid grid-cols-1 gap-4 px-4 py-3 md:grid-cols-2 lg:grid-cols-3">
            <InfoCol label={t("systemInfo.fields.version")} value={info.version} mono />
            <InfoCol label={t("systemInfo.fields.profile")} value={info.profile} mono highlight />
            <InfoCol label={t("systemInfo.fields.nodeId")} value={info.node_id} mono />
            <InfoCol label={t("systemInfo.fields.python")} value={info.python_version} mono />
            <InfoCol
              label={t("systemInfo.fields.fastapi")}
              value={info.fastapi_version ?? "—"}
              mono
            />
            <InfoCol
              label={t("systemInfo.fields.postgresql")}
              value={info.db_version ?? "—"}
              mono
            />
            <InfoCol
              label={t("systemInfo.fields.redis")}
              value={info.redis_version ?? "—"}
              mono
            />
            <InfoCol
              label={t("systemInfo.fields.ldapUri")}
              value={info.ldap_uri ?? "—"}
              mono
            />
            <InfoCol
              label={t("systemInfo.fields.ldapBaseDn")}
              value={info.ldap_base_dn ?? "—"}
              mono
            />
          </div>

          {info.services.length > 0 && (
            <div className="border-t border-border px-4 py-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                {t("serviceStatus")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {info.services.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1"
                  >
                    <span className="font-mono text-xs text-fg">{s.name}</span>
                    <ServiceStatusBadge status={s.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Kategori panelleri */}
      {settingsLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      ) : (
        settings?.categories.map((cat) => (
          <CategoryPanel
            key={cat.category}
            category={cat}
            defaultExpanded={cat.category !== "email_templates"}
            extraAction={
              cat.category === "smtp" ? (
                <button
                  type="button"
                  onClick={() => setSmtpDialog(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  <Send className="h-3 w-3" />
                  Test maili gönder
                </button>
              ) : cat.category === "sms" ? (
                <button
                  type="button"
                  onClick={() => setSmsDialog(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  <Send className="h-3 w-3" />
                  Test SMS gönder
                </button>
              ) : cat.category === "notifications" ? (
                <button
                  type="button"
                  onClick={() => setNotifDialog(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  <Send className="h-3 w-3" />
                  Test bildirim gönder
                </button>
              ) : undefined
            }
          />
        ))
      )}

      <SmtpTestDialog open={smtpDialog} onClose={() => setSmtpDialog(false)} />
      <SmsTestDialog open={smsDialog} onClose={() => setSmsDialog(false)} />
      <NotificationsTestDialog open={notifDialog} onClose={() => setNotifDialog(false)} />
    </div>
  );
}

function InfoCol({
  label,
  value,
  mono = false,
  highlight = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      <div
        className={[
          "mt-0.5 truncate",
          mono ? "font-mono text-xs" : "text-sm",
          highlight ? "font-semibold text-primary" : "text-fg",
        ].join(" ")}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

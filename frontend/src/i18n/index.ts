// SPDX-License-Identifier: Apache-2.0
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import trCommon from "./locales/tr/common.json";
import trSidebar from "./locales/tr/sidebar.json";
import trDashboard from "./locales/tr/dashboard.json";
import trAuth from "./locales/tr/auth.json";
import trProfile from "./locales/tr/profile.json";
import trUsers from "./locales/tr/users.json";
import trGroups from "./locales/tr/groups.json";
import trAdmins from "./locales/tr/admins.json";
import trRoles from "./locales/tr/roles.json";
import trAudit from "./locales/tr/audit.json";
import trAlerts from "./locales/tr/alerts.json";
import trCluster from "./locales/tr/cluster.json";
import trSync from "./locales/tr/sync.json";
import trSettings from "./locales/tr/settings.json";
import trPortal from "./locales/tr/portal.json";
import trBulk from "./locales/tr/bulk.json";
import trShield from "./locales/tr/shield.json";

import enCommon from "./locales/en/common.json";
import enSidebar from "./locales/en/sidebar.json";
import enDashboard from "./locales/en/dashboard.json";
import enAuth from "./locales/en/auth.json";
import enProfile from "./locales/en/profile.json";
import enUsers from "./locales/en/users.json";
import enGroups from "./locales/en/groups.json";
import enAdmins from "./locales/en/admins.json";
import enRoles from "./locales/en/roles.json";
import enAudit from "./locales/en/audit.json";
import enAlerts from "./locales/en/alerts.json";
import enCluster from "./locales/en/cluster.json";
import enSync from "./locales/en/sync.json";
import enSettings from "./locales/en/settings.json";
import enPortal from "./locales/en/portal.json";
import enBulk from "./locales/en/bulk.json";
import enShield from "./locales/en/shield.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      tr: { common: trCommon, sidebar: trSidebar, dashboard: trDashboard, auth: trAuth, profile: trProfile, users: trUsers, groups: trGroups, admins: trAdmins, roles: trRoles, audit: trAudit, alerts: trAlerts, cluster: trCluster, sync: trSync, settings: trSettings, portal: trPortal, bulk: trBulk, shield: trShield },
      en: { common: enCommon, sidebar: enSidebar, dashboard: enDashboard, auth: enAuth, profile: enProfile, users: enUsers, groups: enGroups, admins: enAdmins, roles: enRoles, audit: enAudit, alerts: enAlerts, cluster: enCluster, sync: enSync, settings: enSettings, portal: enPortal, bulk: enBulk, shield: enShield },
    },
    fallbackLng: "tr",
    supportedLngs: ["tr", "en"],
    defaultNS: "common",
    ns: ["common", "sidebar", "dashboard", "auth", "profile", "users", "groups", "admins", "roles", "audit", "alerts", "cluster", "sync", "settings", "portal", "bulk", "shield"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "mtl-lang",
      caches: ["localStorage"],
    },
    react: { useSuspense: false },
  });

export default i18n;

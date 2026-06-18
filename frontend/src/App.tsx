import { lazy, Suspense, useState, useEffect } from "react";
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
import { Navigate, Route, Routes } from "react-router-dom";

import { Shell } from "./components/layout/Shell";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { ChangePasswordTokenPage } from "./pages/ChangePasswordToken";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { ProfilePage } from "./pages/Profile";
import { useAuthStore } from "./lib/auth";

// Tur 7 — kullanıcı / grup / bulk
import { PageLoadingSpinner } from "@/components/ui/PageLoadingSpinner";
import { CommandPalette } from "@/components/search/CommandPalette";
import { KeyboardShortcutsModal } from "@/components/help/KeyboardShortcutsModal";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

const UsersList = lazy(() => import("./pages/users/UsersList"));
const UserCreate = lazy(() => import("./pages/users/UserCreate"));
const UserDetail = lazy(() => import("./pages/users/UserDetail"));
const GroupsList = lazy(() => import("./pages/groups/GroupsList"));
const GroupDetail = lazy(() => import("./pages/groups/GroupDetail"));
const BulkImport = lazy(() => import("./pages/bulk/BulkImport"));
const BulkJobStatusPage = lazy(() => import("./pages/bulk/BulkJobStatus"));
// Tur 8 — admin / rol
const AdminsList = lazy(() => import("./pages/admins/AdminsList"));
const AdminCreate = lazy(() => import("./pages/admins/AdminCreate"));
const AdminDetail = lazy(() => import("./pages/admins/AdminDetail"));
const RolesList = lazy(() => import("./pages/roles/RolesList"));
const RoleDetail = lazy(() => import("./pages/roles/RoleDetail"));
// Tur 9 — audit / alerts / cluster / sync
const AuditEvents = lazy(() => import("./pages/audit/AuditEvents"));
const AuditEventDetail = lazy(() => import("./pages/audit/AuditEventDetail"));
const AlertsPage = lazy(() => import("./pages/alerts/AlertsPage"));
const AlertEventDetail = lazy(() => import("./pages/alerts/AlertEventDetail"));
const ClusterPage = lazy(() => import("./pages/cluster/ClusterPage"));
const SyncPage = lazy(() => import("./pages/sync/SyncPage"));
// Tur 10 — sistem ayarları
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const ShieldPage = lazy(() => import("./pages/shield/ShieldPage"));
// Self-service Portal
import { PortalLayout } from "./portal/layout/PortalLayout";
import { PortalAuthLayout } from "./portal/layout/PortalAuthLayout";
import { PortalProtectedRoute } from "./portal/layout/PortalProtectedRoute";
import { useTranslation } from "react-i18next";
const PortalLogin = lazy(() => import("./portal/pages/PortalLogin"));
const PortalReset = lazy(() => import("./portal/pages/PortalReset"));
const PortalDashboard = lazy(() => import("./portal/pages/PortalDashboard"));
const PortalProfile = lazy(() => import("./portal/pages/PortalProfile"));
const PortalMfa = lazy(() => import("./portal/pages/PortalMfa"));
const PortalChangePassword = lazy(() => import("./portal/pages/PortalChangePassword"));
const MTL_PROFILE: "MASTER" | "SLAVE" =
  ((import.meta as any).env?.VITE_MTL_PROFILE as "MASTER" | "SLAVE" | undefined) ?? "MASTER";

export default function App() {
  const { t } = useTranslation("common");
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  useGlobalShortcuts(() => setShortcutsModalOpen(true));

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const isAuthenticated = useAuthStore((s) => !!s.tokens?.access_token);

  // SLAVE profili: yalnızca portal, kökte (admin shell render edilmez)
  if (MTL_PROFILE === "SLAVE") {
    return (
      <Suspense fallback={<PageLoadingSpinner />}>
        <Routes>
          <Route element={<PortalAuthLayout />}>
            <Route path="/login" element={<PortalLogin />} />
            <Route path="/reset" element={<PortalReset />} />
          </Route>
          <Route element={<PortalProtectedRoute />}>
            <Route element={<PortalLayout />}>
              <Route index element={<PortalDashboard />} />
              <Route path="/profile" element={<PortalProfile />} />
              <Route path="/password" element={<PortalChangePassword />} />
              <Route path="/mfa" element={<PortalMfa />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoadingSpinner />}>
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
      <KeyboardShortcutsModal open={shortcutsModalOpen} onClose={() => setShortcutsModalOpen(false)} />

      <Routes>
      {/* Auth akışı (public) */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route path="/change-password" element={<ChangePasswordTokenPage />} />

      {/* Korumalı uygulama gövdesi — Shell layout (sol menü + header) */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />

          {/* Tur 7 — Kullanıcı / Grup yönetimi */}
          <Route path="users"              element={<UsersList />} />
          <Route path="users/new"          element={<UserCreate />} />
          <Route path="users/bulk-import"  element={<BulkImport />} />
          <Route path="users/:uid"         element={<UserDetail />} />
          <Route path="groups"             element={<GroupsList />} />
          <Route path="groups/bulk-import" element={<BulkImport />} />
          <Route path="groups/:cn"         element={<GroupDetail />} />
          <Route path="bulk/jobs/:id"      element={<BulkJobStatusPage />} />

          {/* Tur 8 — Yönetici / Rol yönetimi */}
          <Route path="admins"             element={<AdminsList />} />
          <Route path="admins/new"         element={<AdminCreate />} />
          <Route path="admins/:id"         element={<AdminDetail />} />
          <Route path="roles"              element={<RolesList />} />
          <Route path="roles/:name"        element={<RoleDetail />} />

          {/* Tur 9 — Gözlem & Operasyon */}
          <Route path="audit"              element={<AuditEvents />} />
          <Route path="audit/:id"          element={<AuditEventDetail />} />
          <Route path="alerts"             element={<AlertsPage />} />
          <Route path="alerts/:id"         element={<AlertEventDetail />} />
          <Route path="cluster"            element={<ClusterPage />} />
          <Route path="sync"               element={<SyncPage />} />

          {/* Tur 10 — Sistem */}
          <Route path="settings"           element={<SettingsPage />} />
          <Route path="shield" element={<ShieldPage />} />
        </Route>
      </Route>

      {/* Catch-all — bilinmeyen URL'leri ana sayfaya yönlendir */}
      
      {/* Self-service Portal — Shell dışında, ayrı layout */}
      <Route path="/portal" element={<PortalAuthLayout />}>
        <Route path="login" element={<PortalLogin />} />
        <Route path="reset" element={<PortalReset />} />
      </Route>
      <Route path="/portal" element={<PortalProtectedRoute />}>
        <Route element={<PortalLayout />}>
          <Route index element={<PortalDashboard />} />
          <Route path="profile" element={<PortalProfile />} />
          <Route path="password" element={<PortalChangePassword />} />
          <Route path="mfa" element={<PortalMfa />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

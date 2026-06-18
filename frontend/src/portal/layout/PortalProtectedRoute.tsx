// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { Navigate, Outlet, useLocation } from "react-router-dom";

import { usePortalAuthStore } from "@/portal/lib/portalAuthStore";
import { portalPath } from "@/portal/lib/portalRoutes";

export function PortalProtectedRoute() {
  const isAuthenticated = usePortalAuthStore((s) => s.isAuthenticated());
  const user = usePortalAuthStore((s) => s.user);
  const location = useLocation();

  if (!isAuthenticated) {
    return (
      <Navigate
        to={portalPath("login")}
        state={{ from: location.pathname }}
        replace
      />
    );
  }
  // Zorunlu parola değişimi tamamlanmadan diğer portal sayfalarına izin verme
  if (user?.must_change_password && location.pathname !== portalPath("password")) {
    return <Navigate to={portalPath("password")} replace />;
  }
  return <Outlet />;
}

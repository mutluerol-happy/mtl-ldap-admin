// SPDX-License-Identifier: Apache-2.0
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuthStore } from "@/lib/auth";

export function ProtectedRoute() {
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => !!s.tokens?.access_token);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

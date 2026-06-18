// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// ============================================================================
// Tur 7 — App.tsx için ROUTE eklemeleri
// ----------------------------------------------------------------------------
// Bu dosya ÇALIŞTIRILMAYA YÖNELİK DEĞİLDİR. Tur 6'daki `src/App.tsx`
// (veya routes dosyası) içinde mevcut <Routes> bloğuna aşağıdaki Route
// satırlarını ekleyin.
//
// VARSAYIMLAR:
//   - Tur 6'da react-router-dom v6 kullanılıyor
//   - Auth + Layout sarmalı dış katmanda (mevcut /users veya /admin altında).
//   - Bu sayfaların hepsi admin yetkisi gerektirir; Tur 6'daki
//     <RequireAdmin>/<ProtectedRoute> bileşeni içine sarmalanabilir.
// ============================================================================

import { Route } from "react-router-dom";
import { lazy } from "react";

// Lazy import'lar (code splitting):
const UsersList    = lazy(() => import("@/pages/users/UsersList"));
const UserCreate   = lazy(() => import("@/pages/users/UserCreate"));
const UserDetail   = lazy(() => import("@/pages/users/UserDetail"));
const GroupsList   = lazy(() => import("@/pages/groups/GroupsList"));
const GroupDetail  = lazy(() => import("@/pages/groups/GroupDetail"));
const BulkImport   = lazy(() => import("@/pages/bulk/BulkImport"));
const BulkJobStatusPage = lazy(() => import("@/pages/bulk/BulkJobStatus"));

// ----------------------------------------------------------------------------
// EKLENECEK ROUTE'lar (App.tsx içinde mevcut <Routes> bloğuna):
// ----------------------------------------------------------------------------
export const tur7Routes = (
  <>
    {/* Kullanıcılar */}
    <Route path="/users"                element={<UsersList />} />
    <Route path="/users/new"            element={<UserCreate />} />
    <Route path="/users/bulk-import"    element={<BulkImport />} />
    <Route path="/users/:uid"           element={<UserDetail />} />

    {/* Gruplar */}
    <Route path="/groups"               element={<GroupsList />} />
    <Route path="/groups/bulk-import"   element={<BulkImport />} />
    <Route path="/groups/:cn"           element={<GroupDetail />} />

    {/* Toplu içe aktarım job durum sayfası (paylaşımlı) */}
    <Route path="/bulk/jobs/:id"        element={<BulkJobStatusPage />} />
  </>
);

// ----------------------------------------------------------------------------
// ÖRNEK MERGE (App.tsx içindeki mevcut Routes'a):
//
//   <Routes>
//     <Route element={<RequireAdmin />}>              {/* Tur 6'dan */}
//       <Route element={<AdminLayout />}>             {/* Tur 6'dan */}
//         {/* mevcut Tur 6 route'ları */}
//         <Route index element={<Dashboard />} />
//
//         {/* ⬇⬇ Tur 7 route'ları ⬇⬇ */}
//         <Route path="users">
//           <Route index               element={<UsersList />} />
//           <Route path="new"          element={<UserCreate />} />
//           <Route path="bulk-import"  element={<BulkImport />} />
//           <Route path=":uid"         element={<UserDetail />} />
//         </Route>
//         <Route path="groups">
//           <Route index               element={<GroupsList />} />
//           <Route path="bulk-import"  element={<BulkImport />} />
//           <Route path=":cn"          element={<GroupDetail />} />
//         </Route>
//         <Route path="bulk/jobs/:id"  element={<BulkJobStatusPage />} />
//         {/* ⬆⬆ Tur 7 route'ları ⬆⬆ */}
//
//       </Route>
//     </Route>
//   </Routes>
//
// `lazy()` kullanıyorsanız App.tsx'in en üstünde <Suspense fallback={...}>
// ile sarmalanmış olduğundan emin olun.
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// NAVIGATION (Tur 6'daki Sidebar/Nav için):
// ----------------------------------------------------------------------------
// const NAV_ITEMS = [
//   ...existingItems,
//   { label: "Kullanıcılar", to: "/users",  icon: Users },
//   { label: "Gruplar",      to: "/groups", icon: Users2 },
// ];
// ----------------------------------------------------------------------------

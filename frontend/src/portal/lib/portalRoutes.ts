// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Portal rota öneki. SLAVE profilinde portal kök '/' altında servis edilir
// (örn. /login), MASTER profilinde admin uygulamasının altında '/portal/*'.
const MTL_PROFILE: "MASTER" | "SLAVE" =
  ((import.meta as any).env?.VITE_MTL_PROFILE as "MASTER" | "SLAVE" | undefined) ?? "MASTER";

/** SLAVE → "" (kök), MASTER → "/portal" */
export const PORTAL_PREFIX = MTL_PROFILE === "SLAVE" ? "" : "/portal";

export function portalPath(sub = ""): string {
  const s = sub.replace(/^\/+/, "");
  if (!s) return PORTAL_PREFIX || "/";
  return `${PORTAL_PREFIX}/${s}`;
}

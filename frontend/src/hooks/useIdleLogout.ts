// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Kullanici hareketsizligini izler; sure dolunca oturumu kapatir.
// Sure backend ayarindan gelir (security.idle_timeout_minutes; 0 = kapali).
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { useSessionPolicy } from "@/hooks/useSessionPolicy";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
  "wheel",
] as const;

export function useIdleLogout() {
  const { data: policy } = useSessionPolicy();
  const navigate = useNavigate();
  const lastActivity = useRef<number>(Date.now());

  const minutes = policy?.idle_timeout_minutes ?? 0;

  useEffect(() => {
    if (!minutes || minutes <= 0) return; // kapali
    const timeoutMs = minutes * 60_000;

    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );

    const checkMs = Math.min(20_000, Math.max(5_000, Math.floor(timeoutMs / 6)));
    const interval = window.setInterval(() => {
      if (!useAuthStore.getState().tokens) return; // zaten cikis yapilmis
      if (Date.now() - lastActivity.current >= timeoutMs) {
        const rt = useAuthStore.getState().tokens?.refresh_token;
        useAuthStore.getState().clearSession();
        if (rt) api.logout(rt).catch(() => undefined);
        toast.info(
          minutes + " dakika hareketsizlik nedeniyle oturum kapatildi.",
        );
        navigate("/login", { replace: true });
      }
    }, checkMs);

    return () => {
      ACTIVITY_EVENTS.forEach((e) =>
        window.removeEventListener(e, onActivity),
      );
      window.clearInterval(interval);
    };
  }, [minutes, navigate]);
}

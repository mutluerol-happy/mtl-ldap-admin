// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Global klavye kısayolları:
//   g + u  → /users         g + a  → /admins
//   g + g  → /groups        g + r  → /roles
//   g + s  → /settings      g + l  → /audit
//   g + h  → /              g + n  → /alerts
//   g + c  → /cluster       g + y  → /sync
//   ?      → Yardım modal aç (onHelpOpen)
//
// Input/textarea/contentEditable focus'ta tetiklenmez.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const NAV_MAP: Record<string, string> = {
  u: "/users",
  a: "/admins",
  g: "/groups",
  r: "/roles",
  s: "/settings",
  l: "/audit",
  h: "/",
  n: "/alerts",
  c: "/cluster",
  y: "/sync",
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useGlobalShortcuts(onHelpOpen: () => void) {
  const navigate = useNavigate();

  useEffect(() => {
    let lastG = 0; // "g" basılma timestamp'i
    const G_WINDOW_MS = 1200;

    const handleKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // Cmd+K vs ile çakışmasın

      const key = e.key.toLowerCase();

      // ? (Shift+/) → yardım
      if (e.key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        onHelpOpen();
        return;
      }

      const now = Date.now();
      if (key === "g") {
        lastG = now;
        return;
      }

      // g + harf
      if (lastG && now - lastG < G_WINDOW_MS) {
        const target = NAV_MAP[key];
        if (target) {
          e.preventDefault();
          navigate(target);
        }
        lastG = 0;
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [navigate, onHelpOpen]);
}

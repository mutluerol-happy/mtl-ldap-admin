// SPDX-License-Identifier: Apache-2.0
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)} sn önce`;
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  if (diff < 30 * 86400) return `${Math.floor(diff / 86400)} gün önce`;
  return formatDateTime(d);
}

/**
 * Parolayı politikaya göre değerlendir.
 * Backend politikasıyla aynı kurallar — UI'da canlı geri bildirim için.
 */
export function evaluatePassword(password: string, uid?: string) {
  const checks = {
    length: password.length >= 8 && password.length <= 128,
    uppercase: /[A-ZĞÜŞİÖÇ]/.test(password),
    lowercase: /[a-zğüşıöç]/.test(password),
    digit: /\d/.test(password),
    notContainsUid: !uid || !password.toLowerCase().includes(uid.toLowerCase()),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const isValid = Object.values(checks).every(Boolean);
  return { checks, score, isValid };
}

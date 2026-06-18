import i18n from "@/i18n";
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Admin parola formları için policy fetch hook'u.
// Portal kendi hook'unu kullanır (portal/lib/portalApi.ts).

import { useEffect, useRef, useState } from "react";

export interface PasswordPolicy {
  min_length: number;
  max_length: number;
  require_upper: boolean;
  require_lower: boolean;
  require_digit: boolean;
  require_special: boolean;
}

const DEFAULT_POLICY: PasswordPolicy = {
  min_length: 8,
  max_length: 128,
  require_upper: true,
  require_lower: true,
  require_digit: true,
  require_special: false,
};

// Modül-seviyesi cache — bütün form'lar aynı policy'yi paylaşsın
let cachedPolicy: PasswordPolicy | null = null;
let inflight: Promise<PasswordPolicy> | null = null;

async function fetchPolicy(): Promise<PasswordPolicy> {
  if (cachedPolicy) return cachedPolicy;
  if (inflight) return inflight;
  inflight = fetch("/api/v1/reset/policy")
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data: any) => {
      const policy: PasswordPolicy = {
        min_length: Number(data?.min_length ?? 8) || 8,
        max_length: Number(data?.max_length ?? 128) || 128,
        require_upper: Boolean(data?.require_upper ?? data?.require_uppercase ?? true),
        require_lower: Boolean(data?.require_lower ?? data?.require_lowercase ?? true),
        require_digit: Boolean(data?.require_digit ?? true),
        require_special: Boolean(data?.require_special ?? false),
      };
      cachedPolicy = policy;
      return policy;
    })
    .catch(() => DEFAULT_POLICY)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function usePasswordPolicy(): PasswordPolicy {
  const [policy, setPolicy] = useState<PasswordPolicy>(
    cachedPolicy ?? DEFAULT_POLICY,
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetchPolicy().then((p) => {
      if (mounted.current) setPolicy(p);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  return policy;
}

// Policy'ye göre frontend-side check'ler — backend yine validate eder ama
// kullanıcı kayar kayar gerçek-zamanlı hint görsün diye
export interface PolicyChecks {
  length: boolean;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  special: boolean;
  notContainsUid: boolean;
}

export function evaluateAgainstPolicy(
  password: string,
  policy: PasswordPolicy,
  username?: string,
): PolicyChecks {
  return {
    length:
      password.length >= policy.min_length && password.length <= policy.max_length,
    upper: !policy.require_upper || /[A-Z]/.test(password),
    lower: !policy.require_lower || /[a-z]/.test(password),
    digit: !policy.require_digit || /\d/.test(password),
    special: !policy.require_special || /[^a-zA-Z0-9]/.test(password),
    notContainsUid:
      !username ||
      username.length < 3 ||
      !password.toLowerCase().includes(username.toLowerCase()),
  };
}

export function policyHintText(policy: PasswordPolicy): string {
  const parts: string[] = [i18n.t("password.lengthRange", { ns: "common", min: policy.min_length, max: policy.max_length })];
  if (policy.require_upper) parts.push(i18n.t("password.upper", { ns: "common" }));
  if (policy.require_lower) parts.push(i18n.t("password.lower", { ns: "common" }));
  if (policy.require_digit) parts.push(i18n.t("password.digit", { ns: "common" }));
  if (policy.require_special) parts.push(i18n.t("password.special", { ns: "common" }));
  return parts.join(", ");
}

// Cache'i sıfırla (Settings değiştirildiğinde kullan)
export function invalidatePolicyCache(): void {
  cachedPolicy = null;
}

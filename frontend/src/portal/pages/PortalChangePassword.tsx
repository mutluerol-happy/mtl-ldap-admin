// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, KeyRound, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import {
  extractPortalError,
  portalApi,
  type PortalPasswordPolicy,
} from "@/portal/lib/portalApi";
import { usePortalAuthStore } from "@/portal/lib/portalAuthStore";
import { portalPath } from "@/portal/lib/portalRoutes";
import { useTranslation } from "react-i18next";

export default function PortalChangePassword() {
  const { t } = useTranslation("portal");
  const navigate = useNavigate();
  const user = usePortalAuthStore((s) => s.user);
  const clearSession = usePortalAuthStore((s) => s.clear);

  const [policy, setPolicy] = useState<PortalPasswordPolicy | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalApi.getResetPolicy().then(setPolicy).catch(() => undefined);
  }, []);

  const mustChange = !!user?.must_change_password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current || !next) return;
    if (next !== confirm) {
      setError(t("changePassword.mismatch"));
      return;
    }
    if (next === current) {
      setError(t("changePassword.sameAsOld"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await portalApi.changePassword({
        current_password: current,
        new_password: next,
      });
      toast.success(t("changePassword.success"));
      clearSession();
      navigate(portalPath("login"), { replace: true });
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-fg-subtle" />
        <div>
          <h1 className="text-xl font-semibold text-fg">{t("changePassword.title")}</h1>
          <p className="text-sm text-fg-subtle">
            {t("changePassword.subtitle")}
          </p>
        </div>
      </div>

      {mustChange && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          <strong>{t("changePassword.requiredAlert")}</strong> {t("changePassword.requiredHint")}
          {t("changePassword.forceMessage")}
        </div>
      )}

      <form
        onSubmit={submit}
        className="rounded-lg border border-border bg-card p-4 space-y-4"
      >
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        <div>
          <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
            {t("changePassword.currentLabel")}
          </label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            autoFocus
            className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
            {t("changePassword.newLabel")}
          </label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={policy?.min_length ?? 8}
            maxLength={policy?.max_length ?? 128}
            className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
            {t("changePassword.confirmLabel")}
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={policy?.min_length ?? 8}
            maxLength={policy?.max_length ?? 128}
            className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {policy && next.length > 0 && <PolicyHints policy={policy} value={next} />}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={loading || !current || !next || next !== confirm}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t("changePassword.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

function PolicyHints({
  policy,
  value,
}: {
  policy: PortalPasswordPolicy;
  value: string;
}) {
  const { t } = useTranslation("portal");
  const checks: Array<{ ok: boolean; label: string }> = [
    {
      ok: value.length >= policy.min_length,
      label: t("changePassword.minLength", { count: policy.min_length }),
    },
  ];
  if (policy.require_upper)
    checks.push({ ok: /[A-Z]/.test(value), label: t("changePassword.uppercase") });
  if (policy.require_lower)
    checks.push({ ok: /[a-z]/.test(value), label: t("changePassword.lowercase") });
  if (policy.require_digit)
    checks.push({ ok: /\d/.test(value), label: t("passwordChecks.digit") });
  if (policy.require_special)
    checks.push({ ok: /[^a-zA-Z0-9]/.test(value), label: t("changePassword.special") });

  return (
    <ul className="grid grid-cols-2 gap-1 text-[11px]">
      {checks.map((c, i) => (
        <li
          key={i}
          className={c.ok ? "text-emerald-600" : "text-fg-subtle"}
        >
          {c.ok ? "✓" : "○"} {c.label}
        </li>
      ))}
    </ul>
  );
}

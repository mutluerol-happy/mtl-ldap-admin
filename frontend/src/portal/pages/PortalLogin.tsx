// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";

import { extractPortalError, portalApi } from "@/portal/lib/portalApi";
import { usePortalAuthStore } from "@/portal/lib/portalAuthStore";
import { portalPath } from "@/portal/lib/portalRoutes";
import { useTranslation } from "react-i18next";

export default function PortalLogin() {
  const { t } = useTranslation("portal");
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = usePortalAuthStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectAfter =
    (location.state as { from?: string } | null)?.from || portalPath();

  const handleResponse = (resp: Awaited<ReturnType<typeof portalApi.login>>) => {
    if (resp.mfa_required && resp.mfa_challenge_id) {
      setMfaChallenge(resp.mfa_challenge_id);
      return;
    }
    if (resp.must_change_password) {
      // Token gelmiş olabilir ama önce parola değişimi gerek
      if (resp.token && resp.expires_at && resp.user) {
        setSession(resp.token, resp.expires_at, resp.user);
      }
      toast.info(t("login.passwordChangeRequired"));
      navigate(portalPath("password"), { replace: true });
      return;
    }
    if (resp.token && resp.expires_at && resp.user) {
      setSession(resp.token, resp.expires_at, resp.user);
      toast.success(t("login.welcome", { name: resp.user.display_name ?? resp.user.username }));
      navigate(redirectAfter, { replace: true });
    }
  };

  const submitPwd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await portalApi.login({ username, password });
      handleResponse(resp);
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaChallenge || mfaCode.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await portalApi.loginWithMfa({
        challenge_id: mfaChallenge,
        code: mfaCode,
      });
      handleResponse(resp);
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  if (mfaChallenge) {
    return (
      <form onSubmit={submitMfa} className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-fg">{t("login.verificationCode")}</h2>
          <p className="text-xs text-fg-subtle mt-0.5">
            {t("login.mfaPrompt")}
          </p>
        </div>
        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
          autoFocus
          className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-center font-mono text-2xl tracking-widest text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="submit"
          disabled={loading || mfaCode.length < 6}
          className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-md bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          {t("login.verifyAndLogin")}
        </button>
        <button
          type="button"
          onClick={() => {
            setMfaChallenge(null);
            setMfaCode("");
            setError(null);
          }}
          className="block w-full text-xs text-fg-subtle hover:text-fg"
        >
          {t("login.backToPassword")}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPwd} className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div>
        <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
          {t("login.username")}
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
          Parola
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !username || !password}
        className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-md bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        {t("login.submit")}
      </button>

      <div className="flex justify-center pt-2 text-xs">
        <Link
          to={portalPath("reset")}
          className="text-fg-subtle hover:text-primary"
        >
          {t("login.forgot")}
        </Link>
      </div>
    </form>
  );
}

function ErrorBanner({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("portal");
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="flex-1 text-xs">{message}</div>
      <button
        type="button"
        onClick={onClose}
        className="text-xs text-danger/60 hover:text-danger"
        aria-label={t("actions.close")}
      >
        ✕
      </button>
    </div>
  );
}

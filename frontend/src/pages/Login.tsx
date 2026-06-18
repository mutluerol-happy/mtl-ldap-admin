// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Polish v2:
//   - "MTL Console" → "MTL Ldap Admin"
//   - Üst terminal şeridi (3 nokta + auth·login + caret) KALDIRILDI
//   - Alttaki scan-line KALDIRILDI
//   - Polish v1 error banner + try/catch korunuyor

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircle , Sun, Moon } from "lucide-react";

import { LoginForm, type LoginFormData } from "@/components/auth/LoginForm";
import { MfaChallenge } from "@/components/auth/MfaChallenge";
import { MfaSetup } from "@/components/auth/MfaSetup";
import { api, extractApiError, type LoginResponse } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";

import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
type Stage = "credentials" | "mfa_challenge" | "mfa_setup";

const MTL_PROFILE: "MASTER" | "SLAVE" =
  ((import.meta as any).env?.VITE_MTL_PROFILE as "MASTER" | "SLAVE" | undefined) ?? "MASTER";

const BRAND_NAME = MTL_PROFILE === "SLAVE" ? "MTL Ldap" : "MTL Ldap Admin";

export function LoginPage() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("mtl-theme") as "dark" | "light") ?? "dark";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("mtl-theme", theme);
  }, [theme]);

  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [stage, setStage] = useState<Stage>("credentials");
  const [isLoading, setIsLoading] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLoginResponse = (resp: LoginResponse) => {
    if (resp.password_change_required && resp.password_change_token) {
      navigate("/change-password", {
        state: { changeToken: resp.password_change_token },
      });
      return;
    }
    if (resp.must_setup_mfa && resp.mfa_setup_token) {
      setSetupToken(resp.mfa_setup_token);
      setStage("mfa_setup");
      return;
    }
    if (resp.mfa_required && resp.mfa_challenge_id) {
      setChallengeId(resp.mfa_challenge_id);
      setStage("mfa_challenge");
      return;
    }
    if (resp.tokens && resp.user) {
      setSession(resp.tokens, resp.user);
      toast.success(`${resp.user.display_name ?? resp.user.username}`);
      navigate("/", { replace: true });
    }
  };

  const handleCredentialsSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setLoginError(null);
    try {
      const resp = await api.login(data.username, data.password);
      handleLoginResponse(resp);
    } catch (err) {
      const { message } = extractApiError(err);
      const msg = message || t("login.failed");
      setLoginError(typeof msg === "string" ? msg : (msg && (msg as any).message) ? String((msg as any).message) : JSON.stringify(msg));
      toast.error(typeof msg === "string" ? msg : JSON.stringify(msg));
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaChallengeSubmit = async (code: string) => {
    if (!challengeId) return;
    setIsLoading(true);
    setMfaError(null);
    try {
      const resp = await api.loginWithMfa(challengeId, code);
      handleLoginResponse(resp);
    } catch (err) {
      const { message } = extractApiError(err);
      setMfaError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSetupComplete = () => {
    setStage("credentials");
    setSetupToken(null);
    toast.info(t("mfa.activated"));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <LanguageSwitcher />
        <button
          type="button"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="p-2 rounded text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors"
          aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
      <div className="absolute inset-0 bg-dots opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-amber/5 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded bg-amber flex items-center justify-center shadow-glow-amber">
              <span className="font-display text-fg-inverse text-lg font-extrabold">
                M
              </span>
            </div>
            <div className="flex flex-col items-start leading-none">
              <span className="mtl-mark text-xl">{BRAND_NAME}</span>
              <span className="text-xs font-mono uppercase tracking-wider-2 text-fg-subtle mt-1">
                {t("brand.subtitle")}
              </span>
            </div>
          </div>
        </div>

        <div className="terminal-frame">
          <div className="p-6 sm:p-8">
            {stage === "credentials" && loginError && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">{t("login.failed")}</div>
                  <div className="text-xs opacity-90">{String(loginError)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setLoginError(null)}
                  className="text-xs text-danger/60 hover:text-danger"
                  aria-label={t("login.close")}
                >
                  ✕
                </button>
              </div>
            )}

            {stage === "credentials" && (
              <LoginForm onSubmit={handleCredentialsSubmit} isLoading={isLoading} />
            )}

            {stage === "mfa_challenge" && (
              <MfaChallenge
                onSubmit={handleMfaChallengeSubmit}
                onBack={() => {
                  setStage("credentials");
                  setMfaError(null);
                  setChallengeId(null);
                }}
                isLoading={isLoading}
                error={mfaError}
              />
            )}

            {stage === "mfa_setup" && setupToken && (
              <MfaSetup
                setupToken={setupToken}
                onComplete={handleMfaSetupComplete}
              />
            )}
          </div>
        </div>

        <div className="mt-6 text-center space-y-1">
          <p className="text-xs font-mono text-fg-subtle tracking-wider-2 uppercase">
            {t("login.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}

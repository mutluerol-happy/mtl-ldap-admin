// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// 3 aşamalı kanal-aware parola sıfırlama:
//   request → verify → complete
// Settings'teki password_reset.channel'a göre email/phone input gösterilir.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail, Phone } from "lucide-react";

import {
  extractPortalError,
  portalApi,
  type PortalPasswordPolicy,
} from "@/portal/lib/portalApi";
import { portalPath } from "@/portal/lib/portalRoutes";

import { useTranslation } from "react-i18next";
type Stage = "request" | "verify" | "complete";
type Channel = "email" | "sms";

export default function PortalReset() {
  const { t } = useTranslation("portal");
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("request");
  const [policy, setPolicy] = useState<PortalPasswordPolicy | null>(null);

  // Stage 1 state
  const [username, setUsername] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestPhone, setRequestPhone] = useState("");
  const [selChannel, setSelChannel] = useState<Channel>("email");

  // Stage 2-3 state
  const [otp, setOtp] = useState("");
  const [completionToken, setCompletionToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Politika yükle
  useEffect(() => {
    portalApi.getResetPolicy().then(setPolicy).catch(() => undefined);
  }, []);

  // Etkin kanal: cfg "both" ise user seçimi, değilse cfg
  const cfgChannel = (policy?.reset_channel || "email") as "email" | "sms" | "both";
  const activeChannel: Channel = useMemo(
    () => (cfgChannel === "both" ? selChannel : (cfgChannel as Channel)),
    [cfgChannel, selChannel],
  );

  // -------------------------------------------------------------------------
  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) return;
    if (activeChannel === "email" && !requestEmail) {
      setError(t("reset.emailRequired"));
      return;
    }
    if (activeChannel === "sms" && !requestPhone) {
      setError(t("reset.phoneRequired"));
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const resp = await portalApi.resetRequest({
        username,
        email: activeChannel === "email" ? requestEmail : undefined,
        phone: activeChannel === "sms" ? requestPhone : undefined,
        channel: cfgChannel === "both" ? selChannel : undefined,
      });
      setMessage(t("reset.otpSent"));
      setStage("verify");
      setError(null);
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  const submitVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || otp.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await portalApi.resetVerify({ username, otp_code: otp });
      setCompletionToken(resp.completion_token);
      setStage("complete");
      setMessage(null);
      setError(null);
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  const submitComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completionToken || !newPassword) return;
    if (newPassword !== newPasswordConfirm) {
      setError(t("reset.passwordsMismatch"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await portalApi.resetComplete({
        completion_token: completionToken,
        new_password: newPassword,
      });
      navigate(portalPath("login"), {
        replace: true,
        state: { resetSuccess: true },
      });
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-fg">{t("reset.title")}</h2>
        <StageIndicator stage={stage} />
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {message && stage !== "complete" && (
        <InfoBanner message={message} onClose={() => setMessage(null)} />
      )}

      {stage === "request" && (
        <form onSubmit={submitRequest} className="space-y-4">
          <p className="text-xs text-fg-subtle">
            {t("reset.instructions.intro", { what: cfgChannel === "both" ? t("reset.instructions.channelChoice") : (activeChannel === "email" ? t("reset.instructions.email") : t("reset.instructions.phone")) })}
          </p>

          <div>
            <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
              {t("reset.username")}
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

          {/* Kanal seçimi (sadece both modunda) */}
          {cfgChannel === "both" && (
            <div>
              <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-2">
                {t("reset.verificationChannel")}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelChannel("email")}
                  className={
                    "flex-1 inline-flex items-center justify-center gap-2 h-9 rounded-md border text-xs font-medium " +
                    (selChannel === "email"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-bg text-fg-subtle hover:text-fg")
                  }
                >
                  <Mail className="h-3.5 w-3.5" />
                  E-posta
                </button>
                <button
                  type="button"
                  onClick={() => setSelChannel("sms")}
                  className={
                    "flex-1 inline-flex items-center justify-center gap-2 h-9 rounded-md border text-xs font-medium " +
                    (selChannel === "sms"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-bg text-fg-subtle hover:text-fg")
                  }
                >
                  <Phone className="h-3.5 w-3.5" />
                  SMS
                </button>
              </div>
            </div>
          )}

          {/* Email input */}
          {activeChannel === "email" && (
            <div>
              <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
                E-posta Adresi
              </label>
              <input
                type="email"
                value={requestEmail}
                onChange={(e) => setRequestEmail(e.target.value)}
                placeholder="ornek@firma.com"
                autoComplete="email"
                className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          {/* Phone input */}
          {activeChannel === "sms" && (
            <div>
              <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
                {t("reset.phoneNumber")}
              </label>
              <input
                type="tel"
                value={requestPhone}
                onChange={(e) => setRequestPhone(e.target.value)}
                placeholder="+905551234567"
                autoComplete="tel"
                className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="mt-1 text-[10px] text-fg-subtle">
                {t("reset.phoneFormat")}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={
              loading ||
              !username ||
              (activeChannel === "email" && !requestEmail) ||
              (activeChannel === "sms" && !requestPhone)
            }
            className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-md bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("reset.send")}
          </button>
        </form>
      )}

      {stage === "verify" && (
        <form onSubmit={submitVerify} className="space-y-4">
          <p className="text-xs text-fg-subtle">
            {activeChannel === "sms"
              ? t("reset.codeSentToPhone")
              : t("reset.codeIntroEmail")}{" "}
            {t("reset.codeValid")}
          </p>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            autoFocus
            className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-center font-mono text-2xl tracking-widest text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            type="submit"
            disabled={loading || otp.length < 6}
            className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-md bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("reset.verify")}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("request");
              setOtp("");
              setError(null);
            }}
            className="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("reset.resend")}
          </button>
        </form>
      )}

      {stage === "complete" && (
        <form onSubmit={submitComplete} className="space-y-4">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700 flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <div>{t("reset.codeVerified")}</div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
              Yeni Parola
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={policy?.min_length ?? 8}
              maxLength={policy?.max_length ?? 128}
              autoFocus
              className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
              Yeni Parola (Tekrar)
            </label>
            <input
              type="password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={policy?.min_length ?? 8}
              maxLength={policy?.max_length ?? 128}
              className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {policy && <PolicyHints policy={policy} value={newPassword} />}

          <button
            type="submit"
            disabled={loading || !newPassword || newPassword !== newPasswordConfirm}
            className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-md bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("reset.resetButton")}
          </button>
        </form>
      )}

      <div className="text-center pt-2">
        <Link to={portalPath("login")} className="text-xs text-fg-subtle hover:text-fg">
          {t("reset.backToLogin")}
        </Link>
      </div>
    </div>
  );
}

// =============================================================================
function StageIndicator({ stage }: { stage: Stage }) {
  const { t } = useTranslation("portal");
  const stages: Array<{ id: Stage; label: string }> = [
    { id: "request", label: "reset.step1" },
    { id: "verify", label: "reset.step2" },
    { id: "complete", label: t("reset.step3") },
  ];
  const current = stages.findIndex((s) => s.id === stage);
  return (
    <div className="flex items-center gap-2 mt-2">
      {stages.map((s, idx) => (
        <div
          key={s.id}
          className={
            idx <= current
              ? "text-[10px] uppercase tracking-wider text-primary font-medium"
              : "text-[10px] uppercase tracking-wider text-fg-subtle"
          }
        >
          {t(s.label)}
          {idx < stages.length - 1 && (
            <span className="mx-2 text-fg-subtle">·</span>
          )}
        </div>
      ))}
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
      label: `En az ${policy.min_length} karakter`,
    },
  ];
  if (policy.require_upper)
    checks.push({ ok: /[A-Z]/.test(value), label: t("passwordChecks.upper") });
  if (policy.require_lower)
    checks.push({ ok: /[a-z]/.test(value), label: t("passwordChecks.lower") });
  if (policy.require_digit)
    checks.push({ ok: /\d/.test(value), label: t("passwordChecks.digit") });
  if (policy.require_special)
    checks.push({ ok: /[^a-zA-Z0-9]/.test(value), label: t("passwordChecks.special") });

  return (
    <ul className="grid grid-cols-2 gap-1 text-[11px]">
      {checks.map((c, i) => (
        <li
          key={i}
          className={c.ok ? "text-emerald-600" : "text-fg-subtle"}
        >
          {c.ok ? "✓" : "○"} {t(c.label)}
        </li>
      ))}
    </ul>
  );
}

function ErrorBanner({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <div className="flex-1">{message}</div>
      <button onClick={onClose} className="hover:text-danger" aria-label="Kapat">
        ✕
      </button>
    </div>
  );
}

function InfoBanner({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-fg">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
      <div className="flex-1">{message}</div>
      <button onClick={onClose} className="hover:text-primary" aria-label="Kapat">
        ✕
      </button>
    </div>
  );
}

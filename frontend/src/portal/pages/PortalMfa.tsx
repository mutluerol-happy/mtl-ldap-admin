// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { toast } from "sonner";

import { extractPortalError, portalApi } from "@/portal/lib/portalApi";
import { usePortalAuthStore } from "@/portal/lib/portalAuthStore";
import { useTranslation } from "react-i18next";

type Phase = "idle" | "setup" | "verify" | "done";

export default function PortalMfa() {
  const { t } = useTranslation("portal");
  const user = usePortalAuthStore((s) => s.user);
  const setUser = usePortalAuthStore((s) => s.setUser);
  const mfaEnabled = !!user?.mfa_enabled;

  const [phase, setPhase] = useState<Phase>("idle");
  const [secret, setSecret] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Setup başlat ----
  const startSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await portalApi.mfaSetup();
      setSecret(resp.secret);
      setQrUri(resp.qr_code_uri);
      setQrImage(resp.qr_code_image ?? null);
      setPhase("setup");
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  // ---- Kod doğrula ----
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6) return;
    setLoading(true);
    setError(null);
    try {
      await portalApi.mfaVerify({ code });
      // Profili refresh et
      const fresh = await portalApi.getProfile();
      setUser(fresh);
      setPhase("done");
      toast.success(t("mfa.activated"));
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  // ---- Disable ----
  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePassword) return;
    setLoading(true);
    setError(null);
    try {
      await portalApi.mfaDisable({ password: disablePassword });
      const fresh = await portalApi.getProfile();
      setUser(fresh);
      setShowDisable(false);
      setDisablePassword("");
      toast.success(t("mfa.disabled"));
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-fg-subtle" />
        <div>
          <h1 className="text-xl font-semibold text-fg">{t("mfa.title")}</h1>
          <p className="text-sm text-fg-subtle">
            {t("mfa.subtitle")}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="flex-1">{error}</div>
          <button
            onClick={() => setError(null)}
            className="text-danger/60 hover:text-danger"
          >
            ✕
          </button>
        </div>
      )}

      {/* MFA durumu */}
      {phase === "idle" && (
        <div className="rounded-lg border border-border bg-card p-4">
          {mfaEnabled ? (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 mb-2">
                <ShieldCheck className="h-4 w-4" />
                {t("mfa.activeBadge")}
              </div>
              <p className="text-sm text-fg-subtle mb-3">
                {t("mfa.activeDescription")}
              </p>
              {!showDisable ? (
                <button
                  type="button"
                  onClick={() => setShowDisable(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 text-sm text-destructive hover:bg-destructive/20"
                >
                  <ShieldOff className="h-4 w-4" />
                  {t("mfa.disable")}
                </button>
              ) : (
                <form onSubmit={disable} className="space-y-3">
                  <label className="block">
                    <span className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
                      {t("mfa.disablePasswordPrompt")}
                    </span>
                    <input
                      type="password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      autoFocus
                      className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={loading || !disablePassword}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-3 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
                    >
                      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {t("mfa.disableSubmit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDisable(false);
                        setDisablePassword("");
                        setError(null);
                      }}
                      className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
                    >
                      {t("common:cancel")}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-amber-600 mb-2">
                <ShieldOff className="h-4 w-4" />
                {t("mfa.inactiveBadge")}
              </div>
              <p className="text-sm text-fg-subtle mb-3">
                {t("mfa.inactiveDescription")}
              </p>
              <button
                type="button"
                onClick={startSetup}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {t("mfa.enableNow")}
              </button>
            </>
          )}
        </div>
      )}

      {phase === "setup" && secret && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <h2 className="text-sm font-semibold text-fg">
            {t("mfa.step1Title")}
          </h2>
          <p className="text-xs text-fg-subtle">
            {t("mfa.step1Description")}
          </p>

          {qrImage ? (
            <div className="flex justify-center">
              <img
                src={
                  qrImage.startsWith("data:")
                    ? qrImage
                    : `data:image/png;base64,${qrImage}`
                }
                alt="QR Code"
                className="rounded bg-white p-2"
                width={200}
                height={200}
              />
            </div>
          ) : (
            <div className="rounded bg-muted/40 p-3 text-center">
              <p className="text-xs text-fg-subtle mb-2">
                QR resmi sunucudan gelmedi — manuel ekleme:
              </p>
              {qrUri && (
                <code className="block break-all font-mono text-[10px] text-fg">
                  {qrUri}
                </code>
              )}
            </div>
          )}

          <div className="rounded-md border border-border bg-bg p-3">
            <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
              Gizli Anahtar
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs text-fg break-all">
                {secret}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(secret).then(() => {
                    toast.success(t("actions.copied"));
                  });
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
                title={t("actions.copy")}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPhase("verify")}
            className="inline-flex w-full h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90"
          >
            {t("mfa.continueButton")}
          </button>
        </div>
      )}

      {phase === "verify" && (
        <form
          onSubmit={verify}
          className="rounded-lg border border-border bg-card p-4 space-y-4"
        >
          <h2 className="text-sm font-semibold text-fg">
            2. Authenticator kodunu girin
          </h2>
          <p className="text-xs text-fg-subtle">
            {t("mfa.step2Description")}
          </p>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
            className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-center font-mono text-2xl tracking-widest text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="inline-flex flex-1 h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("mfa.verifyAndEnable")}
            </button>
            <button
              type="button"
              onClick={() => setPhase("setup")}
              className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
            >
              Geri
            </button>
          </div>
        </form>
      )}

      {phase === "done" && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700">
          <div className="flex items-center gap-2 font-medium mb-1">
            <Check className="h-4 w-4" />
            {t("mfa.successTitle")}
          </div>
          <p className="text-sm">
            {t("mfa.successBody")}
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setSecret(null);
              setQrUri(null);
              setQrImage(null);
              setCode("");
            }}
            className="mt-3 inline-flex h-9 items-center rounded-md border border-emerald-500/40 bg-white px-3 text-sm text-emerald-700 hover:bg-emerald-50"
          >
            Tamam
          </button>
        </div>
      )}
    </div>
  );
}

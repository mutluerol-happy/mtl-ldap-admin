// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { Copy, Check, Smartphone, ShieldPlus } from "lucide-react";
import { toast } from "sonner";

import { Button, FormField, Input, Spinner } from "@/components/ui";
import { api, extractApiError, type MfaSetupResponse } from "@/lib/api";
import { useTranslation } from "react-i18next";

interface MfaSetupProps {
  setupToken: string;
  onComplete: () => void;
}

export function MfaSetup({ setupToken, onComplete }: MfaSetupProps) {
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const { t } = useTranslation("auth");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  useEffect(() => {
    api
      .mfaSetup(setupToken)
      .then((r) => setSetup(r))
      .catch((err) => {
        const { message } = extractApiError(err);
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [setupToken]);

  const copySecret = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setSecretCopied(true);
      toast.success(t("mfa.secretCopied"));
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      toast.error(t("mfa.copyFailed"));
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError("6 haneli TOTP kodu girin");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      await api.mfaVerify(setupToken, code);
      toast.success(t("mfa.activated"));
      onComplete();
    } catch (err) {
      const { message } = extractApiError(err);
      setError(message);
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Spinner size="lg" className="text-amber" />
        <p className="text-sm text-fg-muted">{t("mfa.qrGenerating")}</p>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
        {error ?? t("mfa.setupFailed")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-amber/40 bg-amber/10 mb-2">
          <ShieldPlus className="h-6 w-6 text-amber" />
        </div>
        <h3 className="font-mono text-base font-semibold uppercase tracking-wider-2 text-fg">
          {t("mfa.setupTitle")}
        </h3>
        <p className="text-sm text-fg-muted leading-relaxed">
          {t("mfa.requiredHint")}
          <br />
          {t("mfa.connectApp")}
        </p>
      </div>

      {/* Adım 1: QR kod */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-label">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber text-fg-inverse text-[0.7rem] font-bold">
            1
          </span>
          <span>{t("mfa.scanQR")}</span>
        </div>
        <div className="flex justify-center p-4 bg-white rounded-md">
          <img
            src={setup.qr_code_data_uri}
            alt="MFA QR kod"
            className="h-44 w-44"
          />
        </div>
        <div className="flex items-start gap-2 text-xs text-fg-subtle">
          <Smartphone className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>
            Google Authenticator, Authy, 1Password, Microsoft Authenticator
          </p>
        </div>
      </div>

      {/* Manuel anahtar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-label">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg-elevated border border-border text-[0.7rem] font-bold text-fg-muted">
            ⌥
          </span>
          <span>{t("mfa.manualCode")}</span>
        </div>
        <div className="flex gap-2">
          <Input
            value={setup.secret}
            readOnly
            monospace
            className="text-xs"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={copySecret}
            className="shrink-0 px-3"
          >
            {secretCopied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Adım 2: Doğrulama */}
      <form onSubmit={handleVerify} className="space-y-3">
        <FormField
          label={t("mfa.codeStep")}
          htmlFor="mfa-totp"
          error={error ?? undefined}
        >
          <Input
            id="mfa-totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            invalid={!!error}
            monospace
            className="text-center text-xl tracking-widest h-14"
          />
        </FormField>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={verifying}
          disabled={code.length !== 6}
          className="w-full"
        >
          Doğrula ve Aktive Et
        </Button>
      </form>
    </div>
  );
}

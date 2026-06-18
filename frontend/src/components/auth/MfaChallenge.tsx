// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface MfaChallengeProps {
  onSubmit: (code: string) => Promise<void>;
  onBack?: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function MfaChallenge({ onSubmit, onBack, isLoading, error }: MfaChallengeProps) {
  const { t } = useTranslation("auth");

  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const setDigit = (idx: number, value: string) => {
    const sanitized = value.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = sanitized;
      return next;
    });
    if (sanitized && idx < 5) {
      inputs.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowLeft" && idx > 0) {
      inputs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      inputs.current[idx + 1]?.focus();
    } else if (e.key === "Enter") {
      const code = digits.join("");
      if (code.length === 6) handleSubmit(code);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = pasted.split("").concat(Array(6).fill("")).slice(0, 6);
    setDigits(next);
    const focusIdx = Math.min(pasted.length, 5);
    inputs.current[focusIdx]?.focus();
  };

  const handleSubmit = async (code?: string) => {
    const finalCode = code ?? digits.join("");
    if (finalCode.length !== 6) return;
    await onSubmit(finalCode);
  };

  const isComplete = digits.every((d) => d !== "");

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-amber/40 bg-amber/10 mb-2">
          <ShieldCheck className="h-6 w-6 text-amber" />
        </div>
        <h3 className="font-mono text-base font-semibold uppercase tracking-wider-2 text-fg">
          {t("mfa.title")}
        </h3>
        <p className="text-sm text-fg-muted leading-relaxed">
          {t("mfa.subtitle")}
          <br />
          6 haneli kodu girin
        </p>
      </div>

      <div
        className="flex justify-center gap-2"
        role="group"
        aria-label={t("mfa.codeLabel")}
      >
        {digits.map((digit, idx) => (
          <input
            key={idx}
            ref={(el) => (inputs.current[idx] = el)}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => setDigit(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={handlePaste}
            disabled={isLoading}
            className={cn(
              "h-14 w-12 rounded-md border bg-bg-inset text-center",
              "font-mono text-2xl font-bold text-fg",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:border-amber/60",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              error
                ? "border-danger/60 animate-pulse"
                : digit
                  ? "border-amber/60"
                  : "border-border",
            )}
            aria-label={t("mfa.digitLabel", { n: idx + 1 })}
          />
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger text-center">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          loading={isLoading}
          disabled={!isComplete}
          onClick={() => handleSubmit()}
          className="w-full"
        >
          {t("mfa.verify")}
        </Button>

        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="w-full"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Geri
          </Button>
        )}
      </div>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Alert, Button, FormField, Input } from "@/components/ui";
import { api, extractApiError } from "@/lib/api";
import {
  usePasswordPolicy,
  evaluateAgainstPolicy,
  policyHintText,
} from "@/hooks/usePasswordPolicy";
import { evaluatePassword } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const schema = z
  .object({
    current_password: z.string().min(1, "Mevcut parola zorunlu"),
    new_password: z.string().min(1, "Parola zorunlu").max(200),
    confirm_password: z.string().min(1, "Tekrar zorunlu"),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Parolalar eşleşmiyor",
    path: ["confirm_password"],
  });

type FormData = z.infer<typeof schema>;

export function ChangePasswordTokenPage() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const location = useLocation();
  const changeToken = (location.state as { changeToken?: string })?.changeToken;

  const policy = usePasswordPolicy();
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  const newPassword = watch("new_password");
  const { checks: legacyChecks } = evaluatePassword(newPassword);
  const checks = {
    length: newPassword.length >= policy.min_length && newPassword.length <= policy.max_length,
    uppercase: !policy.require_upper || /[A-Z]/.test(newPassword),
    lowercase: !policy.require_lower || /[a-z]/.test(newPassword),
    digit: !policy.require_digit || /\d/.test(newPassword),
    special: !policy.require_special || /[^a-zA-Z0-9]/.test(newPassword),
    notContainsUid: legacyChecks.notContainsUid,
  };

  const onSubmit = async (data: FormData) => {
    if (!changeToken) {
      setServerError("Token bulunamadı — lütfen tekrar giriş yapın");
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      await api.changePasswordWithToken(
        changeToken,
        data.current_password,
        data.new_password,
      );
      toast.success("Parola güncellendi — yeniden giriş yapın");
      // Eski admin session'ı temizle (portal session'ı korunur)
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith("mtl-") && !k.startsWith("mtl-portal-"))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        /* yutuldu */
      }
      // Hard redirect — React state tamamen sıfırlanır
      setTimeout(() => {
        window.location.href = "/login";
      }, 300);
    } catch (err) {
      // Defansif: backend bazen {error: {message, details: {errors: [...]}}} döner
      try {
        const apiErr: any = extractApiError(err);
        let msg: string;
        if (typeof apiErr === "string") {
          msg = apiErr;
        } else if (apiErr && typeof apiErr === "object") {
          msg = String(apiErr.message ?? "Beklenmeyen hata");
          // Validation detaylarını ekle
          const errors = apiErr?.details?.errors ?? apiErr?.errors;
          if (Array.isArray(errors) && errors.length > 0) {
            const detail = errors
              .map((e: any) => `${e.field ?? "?"}: ${e.message ?? "?"}`)
              .join("; ");
            msg = `${msg} — ${detail}`;
          }
        } else {
          msg = "Beklenmeyen hata";
        }
        setServerError(msg);
      } catch (innerErr) {
        // extractApiError bile patlarsa, son çare
        setServerError(
          err instanceof Error ? err.message : "Beklenmeyen hata",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!changeToken) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Alert variant="danger" title="Geçersiz Erişim">
            Bu sayfaya doğrudan erişilemez. Lütfen giriş yapın.
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/login", { replace: true })}
              >
                Giriş sayfasına dön
              </Button>
            </div>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-dots opacity-40 pointer-events-none" />
      <div className="relative z-10 w-full max-w-md">
        {/* Başlık */}
        <div className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-amber/40 bg-amber/10 mb-3">
            <ShieldCheck className="h-6 w-6 text-amber" />
          </div>
          <h1 className="font-mono text-lg font-semibold uppercase tracking-wider-2 text-fg">
            Parola Yenileme Gerekli
          </h1>
          <p className="text-sm text-fg-muted mt-2">
            İlk giriş veya politika gereği parolanızı değiştirmeniz gerekiyor.
          </p>
        </div>

        <div className="terminal-frame">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-inset/40">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
            </div>
            <span className="font-mono text-[0.65rem] uppercase tracking-wider-2 text-fg-subtle">
              auth · change-password
            </span>
            <span className="h-1 w-3 bg-amber animate-blink-caret" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="p-6 sm:p-8 space-y-5">
            <FormField
              label="Mevcut Parola"
              htmlFor="cur-pwd"
              required
              error={errors.current_password?.message}
            >
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle pointer-events-none" />
                <Input
                  id="cur-pwd"
                  type="password"
                  autoComplete="current-password"
                  invalid={!!errors.current_password}
                  monospace
                  className="pl-9"
                  {...register("current_password")}
                />
              </div>
            </FormField>

            <FormField
              label="Yeni Parola"
              htmlFor="new-pwd"
              required
              error={errors.new_password?.message}
            >
              <div className="relative">
                <Input
                  id="new-pwd"
                  type={showNew ? "text" : "password"}
                  autoComplete="new-password"
                  invalid={!!errors.new_password}
                  monospace
                  className="pr-10"
                  {...register("new_password")}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-fg-subtle hover:text-fg rounded-sm hover:bg-bg-elevated transition-colors"
                >
                  {showNew ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </FormField>

            {/* Parola kontrol listesi */}
            {newPassword && (
              <ul className="text-xs space-y-1 font-mono">
                <PolicyCheck ok={checks.length} label={`${policy.min_length}-${policy.max_length} karakter`} />
                <PolicyCheck ok={checks.uppercase} label="En az 1 büyük harf" />
                <PolicyCheck ok={checks.lowercase} label="En az 1 küçük harf" />
                <PolicyCheck ok={checks.digit} label="En az 1 rakam" />
                <PolicyCheck
                  ok={checks.notContainsUid}
                  label="Kullanıcı adınızı içermez"
                />
              </ul>
            )}

            <FormField
              label="Yeni Parola Tekrar"
              htmlFor="conf-pwd"
              required
              error={errors.confirm_password?.message}
            >
              <div className="relative">
                <Input
                  id="conf-pwd"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  invalid={!!errors.confirm_password}
                  monospace
                  className="pr-10"
                  {...register("confirm_password")}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-fg-subtle hover:text-fg rounded-sm hover:bg-bg-elevated transition-colors"
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </FormField>

            {serverError && (
              <Alert variant="danger" icon>
                {serverError}
              </Alert>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              className="w-full"
            >
              Parolayı Güncelle
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function PolicyCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={
        ok ? "text-success flex items-center gap-2" : "text-fg-subtle flex items-center gap-2"
      }
    >
      <span>{ok ? "●" : "○"}</span>
      <span>{label}</span>
    </li>
  );
}

// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LogIn, User, KeyRound, Eye, EyeOff } from "lucide-react";

import { Button, FormField, Input } from "@/components/ui";
import { extractApiError } from "@/lib/api";
import { useTranslation } from "react-i18next";

const loginSchema = z.object({
  username: z
    .string()
    .min(1, "auth:login.usernameRequired")
    .max(64, "auth:login.usernameTooLong"),
  password: z.string().min(1, "auth:login.passwordRequired").max(256, "auth:login.passwordTooLong"),
});

export type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSubmit: (data: LoginFormData) => Promise<void>;
  isLoading?: boolean;
}

export function LoginForm({ onSubmit, isLoading }: LoginFormProps) {
  const { t } = useTranslation("auth");
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const handleFormSubmit = async (data: LoginFormData) => {
    setServerError(null);
    try {
      await onSubmit(data);
    } catch (err) {
      const { message } = extractApiError(err);
      setServerError(message);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      className="space-y-5"
      autoComplete="on"
    >
      <FormField
        label={t("login.usernameLabel")}
        htmlFor="login-username"
        required
        error={errors.username?.message}
      >
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle pointer-events-none" />
          <Input
            id="login-username"
            type="text"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t("login.usernamePlaceholder")}
            invalid={!!errors.username}
            className="pl-9"
            monospace
            {...register("username")}
          />
        </div>
      </FormField>

      <FormField
        label={t("login.passwordLabel")}
        htmlFor="login-password"
        required
        error={errors.password?.message}
      >
        <div className="relative">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle pointer-events-none" />
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder={t("login.passwordPlaceholder")}
            invalid={!!errors.password}
            className="pl-9 pr-10"
            monospace
            {...register("password")}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-fg-subtle hover:text-fg rounded-sm hover:bg-bg-elevated transition-colors"
            aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </FormField>

      {serverError && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger flex items-start gap-2">
          <span className="font-mono text-amber shrink-0">→</span>
          <span>{serverError}</span>
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={isLoading}
        className="w-full"
      >
        <LogIn className="h-4 w-4" />
        {t("login.submit")}
      </Button>
    </form>
  );
}

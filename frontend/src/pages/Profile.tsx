// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  KeyRound,
  ShieldCheck,
  ShieldOff,
  Mail,
  Calendar,
  Hash,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from "@/components/ui";
import { api, extractApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { evaluatePassword, formatDateTime, formatRelative } from "@/lib/utils";
import { usePasswordPolicy, policyHintText } from "@/hooks/usePasswordPolicy";
import { useTranslation } from "react-i18next";

const pwdSchema = z
  .object({
    current_password: z.string().min(1, "Mevcut parola zorunlu"),
    new_password: z.string().min(1, "Parola zorunlu").max(200),
    confirm_password: z.string().min(8),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Parolalar eşleşmiyor",
    path: ["confirm_password"],
  });

type PwdFormData = z.infer<typeof pwdSchema>;

export function ProfilePage() {
  const { t } = useTranslation(["profile", "common"]);
  const cachedUser = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  // Backend'den güncel `/me` çek — cache stale olabilir
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    initialData: cachedUser ?? undefined,
  });

  // user object'i refresh edildiğinde store'u güncelle
  if (me && (!cachedUser || cachedUser.last_login_at !== me.last_login_at)) {
    updateUser(me);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h-display text-2xl">{t("title")}</h1>
        <p className="text-sm text-fg-muted mt-1">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sol: Profil bilgileri */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{t("identity.title")}</CardTitle>
              <CardDescription>
                {t("identity.subtitle")}
              </CardDescription>
            </div>
            {me?.is_active ? (
              <Badge variant="success">{t("identity.active")}</Badge>
            ) : (
              <Badge variant="danger">{t("identity.inactive")}</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading || !me ? (
              <p className="text-sm text-fg-muted">{t("common:labels.loading")}</p>
            ) : (
              <>
                <Row icon={Hash} label={t("identity.username")} value={me.username} />
                <Row
                  icon={Mail}
                  label={t("identity.email")}
                  value={me.email ?? "—"}
                />
                <Row
                  icon={ShieldCheck}
                  label={t("identity.displayName")}
                  value={me.display_name ?? "—"}
                />
                <Row
                  icon={Calendar}
                  label={t("identity.lastLogin")}
                  value={
                    me.last_login_at
                      ? `${formatDateTime(me.last_login_at)} · ${formatRelative(me.last_login_at)}`
                      : "—"
                  }
                />

                <div>
                  <div className="text-label mb-2">{t("identity.roles")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {me.roles.length === 0 && (
                      <span className="text-sm text-fg-subtle">{t("identity.noRoles")}</span>
                    )}
                    {me.roles.map((r) => (
                      <Badge key={r.id} variant="amber">
                        {r.name}
                        {r.requires_mfa && <ShieldCheck className="h-3 w-3" />}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-label mb-2">{t("identity.permissions", { count: me.permissions.length })}</div>
                  <div className="flex flex-wrap gap-1">
                    {me.permissions.slice(0, 24).map((p) => (
                      <Badge key={p} variant="muted">
                        {p}
                      </Badge>
                    ))}
                    {me.permissions.length > 24 && (
                      <Badge variant="muted">+{me.permissions.length - 24}</Badge>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sağ: MFA durumu */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("mfa.title")}</CardTitle>
              <CardDescription>{t("mfa.description")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {me?.mfa_enabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 p-3 rounded border border-success/30 bg-success/5">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <div>
                    <div className="text-sm font-medium text-fg">{t("mfa.active")}</div>
                    <div className="text-xs text-fg-muted mt-0.5">
                      {t("mfa.active")}
                    </div>
                  </div>
                </div>
                <Alert variant="warning" icon>
                  {t("mfa.disable_hint")}
                </Alert>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 p-3 rounded border border-danger/30 bg-danger/5">
                  <ShieldOff className="h-5 w-5 text-danger" />
                  <div>
                    <div className="text-sm font-medium text-fg">{t("mfa.inactive")}</div>
                    <div className="text-xs text-fg-muted mt-0.5">
                      {t("mfa.policy_recommended")}
                    </div>
                  </div>
                </div>
                <Alert variant="info" icon>
                  {t("mfa.policy_hint")}
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Parola değiştirme */}
      <ChangePasswordCard username={me?.username ?? ""} />
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-b-0">
      <Icon className="h-4 w-4 mt-0.5 text-fg-subtle shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-label">{label}</div>
        <div className="text-value mt-0.5 break-all">{value}</div>
      </div>
    </div>
  );
}

function ChangePasswordCard({ username }: { username: string }) {
  const { t } = useTranslation(["profile", "common"]);
  const policy = usePasswordPolicy();
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<PwdFormData>({
    resolver: zodResolver(pwdSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  const newPassword = watch("new_password");
  const { checks } = evaluatePassword(newPassword, username);

  const onSubmit = async (data: PwdFormData) => {
    setSubmitting(true);
    setServerError(null);
    try {
      await api.changeOwnPassword(data.current_password, data.new_password);
      toast.success(t("password.success"));
      reset();
    } catch (err) {
      const { message } = extractApiError(err);
      setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("password.title")}</CardTitle>
          <CardDescription>
            {t("password.description")}
          </CardDescription>
        </div>
        <KeyRound className="h-5 w-5 text-fg-subtle" />
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-md">
          <FormField
            label={t("password.current")}
            htmlFor="profile-cur-pwd"
            required
            error={errors.current_password?.message}
          >
            <Input
              id="profile-cur-pwd"
              type="password"
              autoComplete="current-password"
              invalid={!!errors.current_password}
              monospace
              {...register("current_password")}
            />
          </FormField>

          <FormField
            label={t("password.new")}
            htmlFor="profile-new-pwd"
            required
            error={errors.new_password?.message}
          >
            <div className="relative">
              <Input
                id="profile-new-pwd"
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
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </FormField>

          {newPassword && (
            <ul className="text-xs space-y-1 font-mono">
              {[
                { ok: checks.length, label: `${policy.min_length}-${policy.max_length} karakter` },
                { ok: checks.uppercase, label: "En az 1 büyük harf" },
                { ok: checks.lowercase, label: "En az 1 küçük harf" },
                { ok: checks.digit, label: "En az 1 rakam" },
                { ok: checks.notContainsUid, label: "Kullanıcı adınızı içermez" },
              ].map(({ ok, label }) => (
                <li
                  key={label}
                  className={
                    ok
                      ? "text-success flex items-center gap-2"
                      : "text-fg-subtle flex items-center gap-2"
                  }
                >
                  {ok ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          )}

          <FormField
            label={t("password.confirm")}
            htmlFor="profile-conf-pwd"
            required
            error={errors.confirm_password?.message}
          >
            <div className="relative">
              <Input
                id="profile-conf-pwd"
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
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </FormField>

          {serverError && <Alert variant="danger">{serverError}</Alert>}

          <Button type="submit" variant="primary" loading={submitting}>
            Güncelle
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

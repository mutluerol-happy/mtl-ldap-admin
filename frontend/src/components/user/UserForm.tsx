// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend UserCreateRequest:
//   uid (3-64, regex), cn (1-128), sn (1-64), given_name?, display_name?,
//   email?, phone?, title?, department?, password (12-256),
//   must_change_password (default true), preferred_language (tr|en, default tr)
//
// Backend UserUpdateRequest:
//   cn?, sn?, given_name?, display_name?, email?, phone?, title?, department?,
//   is_active?, preferred_language?

import { FormEvent, useState } from "react";
import type {
  User,
  UserCreatePayload,
  UserUpdatePayload,
} from "@/types/user";
import { usePasswordPolicy, policyHintText } from "@/hooks/usePasswordPolicy";
import { useTranslation } from "react-i18next";

export type UserFormMode = "create" | "edit";

export interface UserFormProps {
  mode: UserFormMode;
  initialValues?: Partial<User>;
  onSubmit: (
    values: UserCreatePayload | UserUpdatePayload,
  ) => void | Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

interface FormState {
  uid: string;
  cn: string;
  sn: string;
  given_name: string;
  display_name: string;
  email: string;
  phone: string;
  title: string;
  department: string;
  password: string;
  password_confirm: string;
  must_change_password: boolean;
  preferred_language: "tr" | "en";
  is_active: boolean;
}

const initialFormState = (init?: Partial<User>): FormState => ({
  uid: init?.uid ?? "",
  cn: init?.cn ?? "",
  sn: init?.sn ?? "",
  given_name: init?.given_name ?? "",
  display_name: init?.display_name ?? "",
  email: init?.email ?? "",
  phone: init?.phone ?? "",
  title: init?.title ?? "",
  department: init?.department ?? "",
  password: "",
  password_confirm: "",
  must_change_password: true,
  preferred_language: (init?.preferred_language as "tr" | "en") ?? "tr",
  is_active: init?.is_active ?? true,
});

const UID_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

export function UserForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
}: UserFormProps) {
  const { t } = useTranslation("common");
  const policy = usePasswordPolicy();
  const [v, setV] = useState<FormState>(initialFormState(initialValues));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>(
    {},
  );

  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  // CN'i otomatik öner: given_name + sn
  const handleSnBlur = () => {
    if (mode === "create" && !v.cn) {
      const suggested = [v.given_name.trim(), v.sn.trim()]
        .filter(Boolean)
        .join(" ");
      if (suggested) set("cn", suggested);
    }
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};

    if (mode === "create") {
      if (!v.uid) next.uid = t("users:form.uidRequired");
      else if (!UID_PATTERN.test(v.uid))
        next.uid =
          t("users:form.uidHint");
    }
    if (!v.cn) next.cn = t("users:form.cnRequired");
    if (!v.sn) next.sn = t("users:form.snRequired");
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))
      next.email = t("users:form.emailInvalid");

    if (mode === "create") {
      if (!v.password) next.password = t("users:form.passwordRequired");
      else if (v.password.length < policy.min_length)
        next.password = t("users:form.passwordPolicy", { min: policy.min_length });
      else if (v.password !== v.password_confirm)
        next.password_confirm = t("users:form.passwordsDontMatch");
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (mode === "create") {
      const payload: UserCreatePayload = {
        uid: v.uid.trim(),
        cn: v.cn.trim(),
        sn: v.sn.trim(),
        given_name: v.given_name.trim() || null,
        display_name: v.display_name.trim() || null,
        email: v.email.trim() || null,
        phone: v.phone.trim() || null,
        title: v.title.trim() || null,
        department: v.department.trim() || null,
        password: v.password,
        must_change_password: v.must_change_password,
        preferred_language: v.preferred_language,
      };
      await onSubmit(payload);
    } else {
      const payload: UserUpdatePayload = {
        cn: v.cn.trim(),
        sn: v.sn.trim(),
        given_name: v.given_name.trim() || null,
        display_name: v.display_name.trim() || null,
        email: v.email.trim() || null,
        phone: v.phone.trim() || null,
        title: v.title.trim() || null,
        department: v.department.trim() || null,
        is_active: v.is_active,
        preferred_language: v.preferred_language,
      };
      await onSubmit(payload);
    }
  };

  return (
    <form onSubmit={handle} className="space-y-5">
      <Section title={t("users:form.identity")}>
        <Grid>
          <Field
            label={t("users:form.uid")}
            required
            error={errors.uid}
            hint={mode === "edit" ? t("users:form.uidLocked") : undefined}
          >
            <input
              type="text"
              value={v.uid}
              onChange={(e) => set("uid", e.target.value.toLowerCase())}
              disabled={mode === "edit"}
              placeholder={t("users:form.uidPlaceholder")}
              className={inputCls(!!errors.uid) + " font-mono"}
            />
          </Field>
          <Field label={t("users:form.sn")} required error={errors.sn}>
            <input
              type="text"
              value={v.sn}
              onChange={(e) => set("sn", e.target.value)}
              onBlur={handleSnBlur}
              className={inputCls(!!errors.sn)}
            />
          </Field>
          <Field label={t("users:form.givenName")}>
            <input
              type="text"
              value={v.given_name}
              onChange={(e) => set("given_name", e.target.value)}
              className={inputCls(false)}
            />
          </Field>
          <Field
            label={t("users:form.cn")}
            required
            error={errors.cn}
            hint={t("users:form.cnHint")}
          >
            <input
              type="text"
              value={v.cn}
              onChange={(e) => set("cn", e.target.value)}
              className={inputCls(!!errors.cn)}
            />
          </Field>
          <Field label={t("users:form.displayName")}>
            <input
              type="text"
              value={v.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              className={inputCls(false)}
            />
          </Field>
          <Field label={t("users:form.preferredLanguage")}>
            <select
              value={v.preferred_language}
              onChange={(e) =>
                set("preferred_language", e.target.value as "tr" | "en")
              }
              className={inputCls(false)}
            >
              <option value="tr">Türkçe</option>
              <option value="en">English</option>
            </select>
          </Field>
        </Grid>
      </Section>

      <Section title={t("users:form.contact")}>
        <Grid>
          <Field label={t("users:form.email")} error={errors.email}>
            <input
              type="email"
              value={v.email}
              onChange={(e) => set("email", e.target.value)}
              className={inputCls(!!errors.email)}
            />
          </Field>
          <Field label={t("users:form.phone")}>
            <input
              type="tel"
              value={v.phone}
              onChange={(e) => set("phone", e.target.value)}
              className={inputCls(false)}
            />
          </Field>
        </Grid>
      </Section>

      <Section title={t("users:form.organization")}>
        <Grid>
          <Field label={t("users:form.title")}>
            <input
              type="text"
              value={v.title}
              onChange={(e) => set("title", e.target.value)}
              className={inputCls(false)}
            />
          </Field>
          <Field label={t("users:form.department")}>
            <input
              type="text"
              value={v.department}
              onChange={(e) => set("department", e.target.value)}
              className={inputCls(false)}
            />
          </Field>
        </Grid>
      </Section>

      {mode === "create" && (
        <Section title={t("users:form.initialPassword")}>
          <Grid>
            <Field label={t("users:form.password")} required error={errors.password}>
              <input
                type="password"
                value={v.password}
                onChange={(e) => set("password", e.target.value)}
                autoComplete="new-password"
                className={inputCls(!!errors.password) + " font-mono"}
              />
            </Field>
            <Field
              label={t("users:form.passwordConfirm")}
              required
              error={errors.password_confirm}
            >
              <input
                type="password"
                value={v.password_confirm}
                onChange={(e) => set("password_confirm", e.target.value)}
                autoComplete="new-password"
                className={inputCls(!!errors.password_confirm) + " font-mono"}
              />
            </Field>
          </Grid>
          <p className="mt-1 text-xs text-fg-subtle">
            {`En az ${policy.min_length} karakter — ${policyHintText(policy)}.`}
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={v.must_change_password}
              onChange={(e) => set("must_change_password", e.target.checked)}
              className="h-4 w-4"
            />
            {t("users:form.mustChangeOnFirstLogin")}
          </label>
        </Section>
      )}

      {mode === "edit" && (
        <Section title={t("users:form.status")}>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={v.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
              className="h-4 w-4"
            />
            Hesap aktif
          </label>
        </Section>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
        >
          {t("common:cancel")}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? t("users:form.saving") : mode === "create" ? t("users:form.create") : t("users:form.save")}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
        {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-destructive">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-fg-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

function inputCls(hasError: boolean): string {
  return [
    "block w-full rounded-md border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle",
    "focus:outline-none focus:ring-2 focus:ring-primary/50",
    "disabled:cursor-not-allowed disabled:opacity-60",
    hasError ? "border-destructive" : "border-border",
  ].join(" ");
}

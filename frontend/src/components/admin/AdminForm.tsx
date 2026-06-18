// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend AdminCreateRequest:
//   username (3-64, regex), display_name (1-128), email (3-255),
//   password (12+, A-Z + a-z + digit + special), role_names[],
//   must_change_password=true, create_in_ldap=true
//
// Backend AdminUpdateRequest:
//   display_name?, email?, is_active?, must_change_password?, security_flags?

import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "@/lib/api";
import { ShieldCheck, Shield } from "lucide-react";

import type {
  Admin,
  AdminCreatePayload,
  AdminUpdatePayload,
} from "@/types/admin";
import { validateAdminPassword } from "@/types/admin";
import type { Role } from "@/types/rbac";
import { usePasswordPolicy, policyHintText } from "@/hooks/usePasswordPolicy";
import { useTranslation } from "react-i18next";

export type AdminFormMode = "create" | "edit";

export interface AdminFormProps {
  mode: AdminFormMode;
  initialValues?: Partial<Admin>;
  /** /roles'tan gelen mevcut rol listesi (form'da multi-select için) */
  availableRoles: Role[];
  onSubmit: (
    values: AdminCreatePayload | AdminUpdatePayload,
  ) => void | Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{1,62}[a-z0-9]$/;

export function AdminForm({
  mode,
  initialValues,
  availableRoles,
  onSubmit,
  onCancel,
  submitting = false,
}: AdminFormProps) {
  const { t } = useTranslation("common");
  const policy = usePasswordPolicy();
  const [username, setUsername] = useState(initialValues?.username ?? "");
  const [createSource, setCreateSource] = useState<"scratch" | "existing">("scratch");
  const [availableUsers, setAvailableUsers] = useState<Array<{uid: string; display_name: string | null; email: string | null; dn: string}>>([]);
  const [selectedExistingUid, setSelectedExistingUid] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    if (mode !== "create" || createSource !== "existing") return;
    setLoadingUsers(true);
    apiClient
      .get("/admins/available-ldap-users", { params: { limit: 500 } })
      .then((r) => setAvailableUsers(r.data?.items || []))
      .catch(() => setAvailableUsers([]))
      .finally(() => setLoadingUsers(false));
  }, [mode, createSource]);

  useEffect(() => {
    if (createSource !== "existing" || !selectedExistingUid) return;
    const u = availableUsers.find((x) => x.uid === selectedExistingUid);
    if (u) {
      setUsername(u.uid);
      setDisplayName(u.display_name || u.uid);
      setEmail(u.email || `${u.uid}@mtl.local`);
    }
  }, [selectedExistingUid, availableUsers, createSource]);
  const [displayName, setDisplayName] = useState(
    initialValues?.display_name ?? "",
  );
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    initialValues?.roles ?? [],
  );
  const [mustChange, setMustChange] = useState(
    initialValues?.must_change_password ?? true,
  );
  const [createInLdap, setCreateInLdap] = useState(true);
  const [isActive, setIsActive] = useState(initialValues?.is_active ?? true);

  const [errors, setErrors] = useState<{
    username?: string;
    display_name?: string;
    email?: string;
    password?: string;
    password_confirm?: string;
    roles?: string;
  }>({});

  const toggleRole = (name: string) => {
    setSelectedRoles((prev) =>
      prev.includes(name) ? prev.filter((r) => r !== name) : [...prev, name],
    );
    setErrors((p) => ({ ...p, roles: undefined }));
  };

  const validate = (): boolean => {
    const next: typeof errors = {};

    if (mode === "create") {
      if (!username) next.username = t("admins:form.usernameRequired");
      else if (!USERNAME_PATTERN.test(username))
        next.username =
          t("admins:form.usernameFormat");
    }
    if (!displayName) next.display_name = t("admins:form.displayNameRequired");
    if (!email) next.email = t("admins:form.emailRequired");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = t("admins:form.emailInvalid");

    if (mode === "create") {
      if (createSource === "scratch") {
        if (!password) next.password = t("admins:form.passwordRequired");
        else if (password.length < policy.min_length)
          next.password = t("admins:form.passwordPolicy", { min: policy.min_length });
        if (password !== passwordConfirm)
          next.password_confirm = t("admins:form.passwordsDontMatch");
      }
      if (selectedRoles.length === 0)
        next.roles = t("admins:form.rolesRequired");
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (mode === "create") {
      const payload: AdminCreatePayload = {
        username: username.trim().toLowerCase(),
        display_name: displayName.trim(),
        email: email.trim().toLowerCase(),
        password: createSource === "scratch" ? password : undefined,
        role_names: selectedRoles,
        must_change_password: mustChange,
        create_in_ldap: createSource === "existing" ? false : createInLdap,
        link_existing_uid: createSource === "existing" ? selectedExistingUid : undefined,
      };
      await onSubmit(payload);
    } else {
      const payload: AdminUpdatePayload = {
        display_name: displayName.trim(),
        email: email.trim().toLowerCase(),
        is_active: isActive,
        must_change_password: mustChange,
      };
      await onSubmit(payload);
    }
  };

  return (
    <form onSubmit={handle} className="space-y-5">
        {mode === "create" && (
          <div className="sm:col-span-2 mb-4">
            <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-2">
              {t("admins:form.source")}
            </label>
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="createSource"
                  value="scratch"
                  checked={createSource === "scratch"}
                  onChange={() => {
                    setCreateSource("scratch");
                    setSelectedExistingUid("");
                  }}
                  className="accent-primary"
                />
                {t("admins:form.scratch")}
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="createSource"
                  value="existing"
                  checked={createSource === "existing"}
                  onChange={() => setCreateSource("existing")}
                  className="accent-primary"
                />
                {t("admins:form.fromLdap")}
              </label>
            </div>
            {createSource === "existing" && (
              <div className="mt-3">
                <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
                  {t("admins:form.ldapUser")}
                </label>
                <select
                  value={selectedExistingUid}
                  onChange={(e) => setSelectedExistingUid(e.target.value)}
                  className="block w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">
                    {loadingUsers
                      ? t("admins:form.loadingLdap")
                      : availableUsers.length === 0
                      ? t("admins:form.noLdapUsers")
                      : t("admins:form.selectPlaceholder")}
                  </option>
                  {availableUsers.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.uid}
                      {u.display_name ? ` — ${u.display_name}` : ""}
                      {u.email ? ` (${u.email})` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-fg-subtle">
                  {t("admins:form.ldapHint")}
                  {t("admins:form.ldapHint2")}
                </p>
              </div>
            )}
          </div>
        )}

              <Section title={t("admins:form.identity")}>
        <Grid>
          <Field
            label={t("admins:form.username")}
            required
            error={errors.username}
            hint={mode === "edit" ? t("admins:form.usernameLocked") : undefined}
          >
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              disabled={mode === "edit" || createSource === "existing"}
              placeholder={t("admins:form.usernamePlaceholder")}
              autoComplete="off"
              className={inputCls(!!errors.username) + " font-mono"}
            />
          </Field>
          <Field label={t("admins:form.displayName")} required error={errors.display_name}>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputCls(!!errors.display_name)}
            />
          </Field>
          <Field label={t("admins:form.email")} required error={errors.email}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls(!!errors.email)}
            />
          </Field>
        </Grid>
      </Section>

      {mode === "create" && createSource === "existing" && (
        <p className="mb-3 text-xs text-fg-subtle">
          {t("admins:form.ldapAuthNote")}
        </p>
      )}
      {mode === "create" && createSource === "scratch" && (
        <Section title={t("admins:form.initialPassword")}>
          <p className="mb-2 text-xs text-fg-subtle">
            {t("admins:form.passwordHint", { min: policy.min_length, max: policy.max_length })} — {policyHintText(policy)}.
          </p>
          <Grid>
            <Field label={t("admins:form.password")} required error={errors.password}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={inputCls(!!errors.password) + " font-mono"}
              />
            </Field>
            <Field
              label={t("admins:form.passwordConfirm")}
              required
              error={errors.password_confirm}
            >
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                className={inputCls(!!errors.password_confirm) + " font-mono"}
              />
            </Field>
          </Grid>
          <label className="mt-3 flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={mustChange}
              onChange={(e) => setMustChange(e.target.checked)}
              className="h-4 w-4"
            />
            {t("admins:form.mustChangeOnFirstLogin")}
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={createInLdap}
              onChange={(e) => setCreateInLdap(e.target.checked)}
              className="h-4 w-4"
            />
            {t("admins:form.alsoCreateInLdap")}
          </label>
        </Section>
      )}

      {mode === "create" && (
        <Section title={t("admins:form.roles")}>
          {errors.roles && (
            <div className="mb-2 text-xs text-destructive">{errors.roles}</div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {availableRoles.map((r) => {
              const isSuper =
                r.name === "mtl.super_admin" || r.name === "super_admin";
              const Icon = isSuper ? ShieldCheck : Shield;
              const selected = selectedRoles.includes(r.name);
              return (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => toggleRole(r.name)}
                  className={[
                    "flex items-start gap-2 rounded-md border px-3 py-2 text-left transition",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-bg hover:bg-muted",
                  ].join(" ")}
                >
                  <Icon
                    className={[
                      "mt-0.5 h-4 w-4 flex-shrink-0",
                      selected ? "text-primary" : "text-fg-subtle",
                    ].join(" ")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm text-fg">
                      {r.name}
                    </span>
                    {r.description && (
                      <span className="block text-xs text-fg-subtle">
                        {r.description}
                      </span>
                    )}
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-fg-subtle">
                      <span className="font-mono">
                        {r.permission_count} {t("admins:form.permissions")}
                      </span>
                      {r.requires_mfa && (
                        <span className="rounded bg-amber-500/10 px-1 text-amber-600">
                          {t("admins:form.mfaRequired")}
                        </span>
                      )}
                      {r.is_system && (
                        <span className="rounded bg-fg-subtle/10 px-1 text-fg-subtle">
                          {t("admins:form.system")}
                        </span>
                      )}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={selected}
                    readOnly
                    className="mt-1 h-4 w-4 pointer-events-none"
                  />
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {mode === "edit" && (
        <Section title={t("admins:form.statusSecurity")}>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            Hesap aktif
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={mustChange}
              onChange={(e) => setMustChange(e.target.checked)}
              className="h-4 w-4"
            />
            {t("admins:form.mustChangeNextLogin")}
          </label>
          <p className="mt-3 text-xs text-fg-subtle">
            {t("admins:form.editRolesNote")}
            {t("admins:form.editActionsNote")}
          </p>
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
          {submitting ? t("admins:form.saving") : mode === "create" ? t("admins:form.create") : t("admins:form.save")}
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

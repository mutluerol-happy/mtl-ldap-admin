// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Pencil,
  KeyRound,
  Power,
  PowerOff,
  Unlock,
  Lock,
  Trash2,
  ShieldOff,
  Users as UsersIcon,
} from "lucide-react";

import { Modal } from "@/components/dialog/Modal";
import { ConfirmDialog } from "@/components/dialog/ConfirmDialog";
import { UserForm } from "@/components/user/UserForm";
import { UserStatusBadge } from "@/components/user/UserStatusBadge";
import { usePasswordPolicy, policyHintText } from "@/hooks/usePasswordPolicy";

import {
  useUser,
  useUserGroups,
  useUpdateUser,
  useDeleteUser,
  useActivateUser,
  useDeactivateUser,
  useLockUser,
  useUnlockUser,
  useResetUserPassword,
  useResetUserMfa,
} from "@/hooks/useUsers";
import type { UserUpdatePayload } from "@/types/user";
import { computeUserStatus } from "@/types/user";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

function fmt(s: string | null): string {
  return s ? new Date(s).toLocaleString("tr-TR") : "—";
}

export default function UserDetail() {
  const { uid = "" } = useParams<{ uid: string }>();
  const { t } = useTranslation(["users", "common"]);
  const navigate = useNavigate();

  const { data: user, isLoading, isError, error } = useUser(uid);
  const { data: groups } = useUserGroups(uid);

  const updateUser = useUpdateUser(uid);
  const deleteUser = useDeleteUser();
  const activateMut = useActivateUser(uid);
  const deactivateMut = useDeactivateUser(uid);
  const lockMut = useLockUser(uid);
  const unlockMut = useUnlockUser(uid);
  const resetPwMut = useResetUserPassword(uid);
  const resetMfaMut = useResetUserMfa(uid);

  const policy = usePasswordPolicy();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetNewPw, setResetNewPw] = useState("");
  const [resetMustChange, setResetMustChange] = useState(true);
  const [resetError, setResetError] = useState<string | null>(null);

  if (isLoading) {
    return <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>;
  }
  if (isError || !user) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t("users:loadError")}: {extractBackendError(error)}
      </div>
    );
  }

  const status = computeUserStatus(user);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => navigate("/users")}
            aria-label={t("detail.back")}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-fg">
                {user.cn || user.uid}
              </h1>
              <UserStatusBadge user={user} />
            </div>
            <div className="font-mono text-xs text-fg-subtle">{user.dn}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
          >
            <Pencil className="h-4 w-4" />
            {t("detail.edit")}
          </button>
          <button
            type="button"
            onClick={() => {
              setResetNewPw("");
              setResetMustChange(true);
              setResetError(null);
              setResetPwOpen(true);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
          >
            <KeyRound className="h-4 w-4" />
            {t("common:userActions.resetPassword")}
          </button>
          {status === "locked" && (
            <button
              type="button"
              onClick={() => unlockMut.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
            >
              <Unlock className="h-4 w-4" />
              {t("common:userActions.unlock")}
            </button>
          )}
          {status === "active" && (
            <button
              type="button"
              onClick={() => lockMut.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
            >
              <Lock className="h-4 w-4" />
              Kilitle
            </button>
          )}
          {status === "disabled" ? (
            <button
              type="button"
              onClick={() => activateMut.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-600/90"
            >
              <Power className="h-4 w-4" />
              {t("common:userActions.activate")}
            </button>
          ) : status === "active" ? (
            <button
              type="button"
              onClick={() => deactivateMut.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
            >
              <PowerOff className="h-4 w-4" />
              {t("common:userActions.disable")}
            </button>
          ) : null}
          {user.mfa_enabled && (
            <button
              type="button"
              onClick={() => resetMfaMut.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
            >
              <ShieldOff className="h-4 w-4" />
              {t("common:userActions.resetMfa")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 text-sm text-destructive hover:bg-destructive/15"
          >
            <Trash2 className="h-4 w-4" />
            {t("detail.delete")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            {t("detail.identity")}
          </h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <DD label={t("fields.uid")} value={user.uid} mono />
            <DD label={t("fields.cn")} value={user.cn} />
            <DD label={t("fields.sn")} value={user.sn ?? "—"} />
            <DD label={t("fields.givenName")} value={user.given_name ?? "—"} />
            <DD label={t("fields.displayName")} value={user.display_name ?? "—"} />
            <DD label={t("fields.preferredLanguage")} value={user.preferred_language ?? "—"} />
            <DD label={t("fields.email")} value={user.email ?? "—"} />
            <DD label={t("fields.phone")} value={user.phone ?? "—"} />
            <DD label={t("fields.title")} value={user.title ?? "—"} />
            <DD label={t("fields.department")} value={user.department ?? "—"} />
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            {t("detail.security")}
          </h2>
          <dl className="space-y-3 text-sm">
            <DD label={t("fields.mfa")} value={user.mfa_enabled ? t("mfaStatus.enabled") : t("mfaStatus.disabled")} />
            <DD label={t("fields.mfaEnrolled")} value={fmt(user.mfa_enrolled_at)} />
            <DD label={t("fields.passwordChanged")} value={fmt(user.password_changed_at)} />
            <DD label={t("fields.passwordExpires")} value={fmt(user.password_expires_at)} />
            <DD label={t("fields.mustChangePassword")} value={user.must_change_password ? t("common:yes") : t("common:no")} />
            <DD label={t("fields.failedLoginCount")} value={String(user.failed_login_count)} mono />
            <DD label={t("fields.lockedUntil")} value={fmt(user.locked_until)} />
            <DD label={t("fields.lastLogin")} value={fmt(user.last_login_at)} />
            <DD label={t("fields.lastLoginIp")} value={user.last_login_ip ?? "—"} mono />
            <DD label="LDAP sync" value={user.ldap_sync_status} />
          </dl>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-fg-subtle" />
            <h2 className="text-sm font-semibold text-fg">{t("detail.membershipsTitle")}</h2>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-subtle">
              {groups?.length ?? 0}
            </span>
          </div>
        </header>
        {!groups || groups.length === 0 ? (
          <div className="px-4 py-6 text-sm text-fg-subtle">
            Bu kullanıcı herhangi bir gruba üye değil.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <li key={g.cn} className="flex items-center justify-between px-4 py-2">
                <Link
                  to={`/groups/${encodeURIComponent(g.cn)}`}
                  className="font-mono text-sm text-primary hover:underline"
                >
                  {g.cn}
                </Link>
                {g.description && (
                  <span className="ml-3 truncate text-xs text-fg-subtle">
                    {g.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t("detail.editTitle", { uid: user.uid })}
        size="lg"
      >
        <UserForm
          mode="edit"
          initialValues={user}
          submitting={updateUser.isPending}
          onCancel={() => setEditOpen(false)}
          onSubmit={async (values) => {
            await updateUser.mutateAsync(values as UserUpdatePayload);
            setEditOpen(false);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await deleteUser.mutateAsync(user.uid);
          navigate("/users");
        }}
        title={t("users:delete.title")}
        description={
          <span>
            <span className="font-mono text-fg">{user.uid}</span> kalıcı olarak
            silinecek.
          </span>
        }
        confirmLabel={t("detail.delete")}
        variant="danger"
        confirmText={user.uid}
      />

      <Modal
        open={resetPwOpen}
        onClose={() => setResetPwOpen(false)}
        title={t("users:passwordReset.title", { name: user.uid })}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setResetPwOpen(false)}
              disabled={resetPwMut.isPending}
              className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
            >
              {t("common:cancel")}
            </button>
            <button
              type="button"
              disabled={resetPwMut.isPending || resetNewPw.length < (policy?.min_length ?? 8)}
              onClick={async () => {
                setResetError(null);
                try {
                  await resetPwMut.mutateAsync({
                    new_password: resetNewPw,
                    must_change: resetMustChange,
                  });
                  setResetPwOpen(false);
                } catch (e) {
                  setResetError(extractBackendError(e));
                }
              }}
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {resetPwMut.isPending ? t("users:passwordReset.submitting") : t("users:passwordReset.button")}
            </button>
          </>
        }
      >
        {resetError && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {resetError}
          </div>
        )}
        <p className="mb-3 text-sm text-fg-subtle">
          {t("reset.policyHint", { min: policy.min_length, hint: policyHintText(policy) })}
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-fg-subtle">
            {t("reset.newPasswordLabel")}
          </span>
          <input
            type="password"
            value={resetNewPw}
            onChange={(e) => setResetNewPw(e.target.value)}
            autoComplete="new-password"
            className="block w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={resetMustChange}
            onChange={(e) => setResetMustChange(e.target.checked)}
            className="h-4 w-4"
          />
          {t("users:passwordReset.forceChange")}
        </label>
      </Modal>
    </div>
  );
}

function DD({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className={mono ? "font-mono text-sm text-fg" : "text-sm text-fg"}>
        {value}
      </dd>
    </div>
  );
}

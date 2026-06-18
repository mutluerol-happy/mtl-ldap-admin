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
  Trash2,
  ShieldOff,
  Shield,
  ShieldCheck,
  Plus,
  X,
} from "lucide-react";

import { Modal } from "@/components/dialog/Modal";
import { ConfirmDialog } from "@/components/dialog/ConfirmDialog";
import { AdminForm } from "@/components/admin/AdminForm";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { AssignRoleDialog } from "@/components/admin/AssignRoleDialog";

import {
  useAdmin,
  useUpdateAdmin,
  useDeleteAdmin,
  useAssignAdminRole,
  useRevokeAdminRole,
  useResetAdminPassword,
  useResetAdminMfa,
} from "@/hooks/useAdmins";
import { useRolesList } from "@/hooks/useRoles";
import { useAuthStore } from "@/lib/auth";
import type { AdminUpdatePayload } from "@/types/admin";
import { computeAdminStatus, validateAdminPassword } from "@/types/admin";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

function fmt(s: string | null): string {
  return s ? new Date(s).toLocaleString("tr-TR") : "—";
}

export default function AdminDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation(["admins", "common"]);
  const navigate = useNavigate();

  // Mevcut oturum sahibi — kendisini silemez, devre dışı bırakamaz
  const currentAdminId = useAuthStore((s) => s.user?.id ?? null);

  const { data: admin, isLoading, isError, error } = useAdmin(id);
  const { data: rolesData } = useRolesList();

  const updateAdmin = useUpdateAdmin(id);
  const deleteAdmin = useDeleteAdmin();
  const assignRole = useAssignAdminRole(id);
  const revokeRole = useRevokeAdminRole(id);
  const resetPwMut = useResetAdminPassword(id);
  const resetMfaMut = useResetAdminMfa(id);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [assignRoleOpen, setAssignRoleOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{
    roleName: string;
    roleId: string;
  } | null>(null);

  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetNewPw, setResetNewPw] = useState("");
  const [resetMustChange, setResetMustChange] = useState(true);
  const [resetError, setResetError] = useState<string | null>(null);

  if (isLoading) {
    return <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>;
  }
  if (isError || !admin) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Admin yüklenemedi: {extractBackendError(error)}
      </div>
    );
  }

  const status = computeAdminStatus(admin);
  const isSelf = currentAdminId === admin.id;

  // Role name → role id mapping (kaldırma endpoint'i UUID istiyor)
  const rolesById: Record<string, string> = {};
  (rolesData?.items ?? []).forEach((r) => {
    rolesById[r.name] = r.id;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => navigate("/admins")}
            aria-label={t("detail.back")}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-fg">
                {admin.display_name}
              </h1>
              <AdminStatusBadge admin={admin} />
              {isSelf && (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Siz
                </span>
              )}
            </div>
            <div className="font-mono text-xs text-fg-subtle">
              {admin.username}
              {admin.ldap_dn && (
                <span className="ml-2">· {admin.ldap_dn}</span>
              )}
            </div>
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
          {admin.mfa_enabled && (
            <button
              type="button"
              onClick={() => resetMfaMut.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
            >
              <ShieldOff className="h-4 w-4" />
              {t("common:userActions.resetMfa")}
            </button>
          )}
          {!isSelf && (
            <>
              {status === "disabled" ? (
                <button
                  type="button"
                  onClick={() =>
                    updateAdmin.mutate({ is_active: true } as AdminUpdatePayload)
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-600/90"
                >
                  <Power className="h-4 w-4" />
                  {t("common:userActions.activate")}
                </button>
              ) : status === "active" ? (
                <button
                  type="button"
                  onClick={() =>
                    updateAdmin.mutate({ is_active: false } as AdminUpdatePayload)
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted"
                >
                  <PowerOff className="h-4 w-4" />
                  {t("common:userActions.disable")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 text-sm text-destructive hover:bg-destructive/15"
              >
                <Trash2 className="h-4 w-4" />
                {t("detail.delete")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Bilgiler
          </h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <DD label={t("fields.username")} value={admin.username} mono />
            <DD label={t("fields.displayName")} value={admin.display_name} />
            <DD label={t("fields.email")} value={admin.email} />
            <DD label={t("fields.ldapDn")} value={admin.ldap_dn ?? "—"} mono />
            <DD label={t("fields.createdAt")} value={fmt(admin.created_at)} />
            <DD label={t("fields.updatedAt")} value={fmt(admin.updated_at)} />
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            {t("detail.security")}
          </h2>
          <dl className="space-y-3 text-sm">
            <DD label={t("fields.mfa")} value={admin.mfa_enabled ? t("mfaStatus.enabled") : t("mfaStatus.disabled")} />
            <DD
              label={t("fields.passwordResetFirstLogin")}
              value={admin.must_change_password ? t("common:yes") : t("common:no")}
            />
            <DD label={t("fields.passwordChanged")} value={fmt(admin.password_changed_at)} />
            <DD
              label={t("fields.failedLoginCount")}
              value={String(admin.failed_login_count)}
              mono
            />
            <DD label={t("fields.lockedUntil")} value={fmt(admin.locked_until)} />
            <DD label={t("fields.lastLogin")} value={fmt(admin.last_login_at)} />
          </dl>
        </div>
      </div>

      {/* Roller */}
      <div className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-fg-subtle" />
            <h2 className="text-sm font-semibold text-fg">{t("detail.rolesTitle")}</h2>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-subtle">
              {admin.roles.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAssignRoleOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Rol ata
          </button>
        </header>
        {admin.roles.length === 0 ? (
          <div className="px-4 py-6 text-sm text-fg-subtle">
            Bu admin'in atanmış rolü yok. (Yetki gerekiyorsa ekleyin.)
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {admin.roles.map((roleName) => {
              const isSuper =
                roleName === "mtl.super_admin" ||
                roleName === "super_admin";
              const Icon = isSuper ? ShieldCheck : Shield;
              const roleId = rolesById[roleName];
              return (
                <li
                  key={roleName}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <Link
                    to={`/roles/${encodeURIComponent(roleName)}`}
                    className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
                  >
                    <Icon
                      className={
                        isSuper ? "h-4 w-4 text-primary" : "h-4 w-4 text-fg-subtle"
                      }
                    />
                    <span className="font-mono text-sm text-primary">
                      {roleName}
                    </span>
                  </Link>
                  <button
                    type="button"
                    disabled={!roleId}
                    onClick={() =>
                      setRevokeTarget({ roleName, roleId: roleId! })
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg px-2 text-xs text-fg-subtle hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t("common:actions.remove")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Permission'lar */}
      <div className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Efektif Yetkiler</h2>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-subtle">
              {admin.permissions.length}
            </span>
          </div>
          <span className="text-xs text-fg-subtle">
            (rollerden hesaplanır — burada düzenlenemez)
          </span>
        </header>
        {admin.permissions.length === 0 ? (
          <div className="px-4 py-6 text-sm text-fg-subtle">
            Bu admin'in efektif yetkisi yok.
          </div>
        ) : (
          <div className="px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              {admin.permissions.map((p) => (
                <span
                  key={p}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-fg"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t("detail.editTitle", { username: admin.username })}
        size="lg"
      >
        <AdminForm
          mode="edit"
          initialValues={admin}
          availableRoles={rolesData?.items ?? []}
          submitting={updateAdmin.isPending}
          onCancel={() => setEditOpen(false)}
          onSubmit={async (values) => {
            await updateAdmin.mutateAsync(values as AdminUpdatePayload);
            setEditOpen(false);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await deleteAdmin.mutateAsync(admin.id);
          navigate("/admins");
        }}
        title={t("delete.title")}
        description={
          <span>
            <span className="font-mono text-fg">{admin.username}</span> admin'i
            kalıcı olarak silinecek. Bu işlem geri alınamaz.
          </span>
        }
        confirmLabel={t("detail.delete")}
        variant="danger"
        confirmText={admin.username}
      />

      <AssignRoleDialog
        open={assignRoleOpen}
        onClose={() => setAssignRoleOpen(false)}
        currentRoleNames={admin.roles}
        onAssign={async (roleName) => {
          await assignRole.mutateAsync({ role_name: roleName });
        }}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={async () => {
          if (!revokeTarget) return;
          await revokeRole.mutateAsync(revokeTarget.roleId);
        }}
        title="Rolü kaldır"
        description={
          revokeTarget && (
            <span>
              <span className="font-mono text-fg">{revokeTarget.roleName}</span>{" "}
              rolü{" "}
              <span className="font-mono text-fg">{admin.username}</span>{" "}
              admin'inden kaldırılacak.
            </span>
          )
        }
        confirmLabel="Kaldır"
        variant="danger"
      />

      <Modal
        open={resetPwOpen}
        onClose={() => setResetPwOpen(false)}
        title={`Parolayı sıfırla: ${admin.username}`}
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
              disabled={
                resetPwMut.isPending ||
                validateAdminPassword(resetNewPw) !== null
              }
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
              {resetPwMut.isPending ? "Sıfırlanıyor…" : "Sıfırla"}
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
          12+ karakter, büyük/küçük harf, rakam ve özel karakter içermeli.
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-fg-subtle">
            {t("detail.newPasswordLabel")}
          </span>
          <input
            type="password"
            value={resetNewPw}
            onChange={(e) => setResetNewPw(e.target.value)}
            autoComplete="new-password"
            className="block w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {resetNewPw && validateAdminPassword(resetNewPw) && (
            <span className="mt-1 block text-xs text-destructive">
              {validateAdminPassword(resetNewPw)}
            </span>
          )}
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={resetMustChange}
            onChange={(e) => setResetMustChange(e.target.checked)}
            className="h-4 w-4"
          />
          Bir sonraki girişte değiştirsin
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

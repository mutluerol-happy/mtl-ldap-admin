// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  UserPlus,
  UserMinus,
} from "lucide-react";

import { Modal } from "@/components/dialog/Modal";
import { ConfirmDialog } from "@/components/dialog/ConfirmDialog";
import { GroupForm } from "@/components/group/GroupForm";
import { MemberPicker } from "@/components/group/MemberPicker";

import {
  useGroup,
  useUpdateGroup,
  useDeleteGroup,
  useAddGroupMember,
  useRemoveGroupMember,
} from "@/hooks/useGroups";
import { usersApi } from "@/lib/api.tur7-additions";
import type { GroupUpdatePayload } from "@/types/group";
import { uidFromDn } from "@/types/group";
import type { User } from "@/types/user";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function GroupDetail() {
  const { cn = "" } = useParams<{ cn: string }>();
  const { t } = useTranslation(["groups", "common"]);
  const navigate = useNavigate();

  const { data: group, isLoading, isError, error } = useGroup(cn);

  const updateGroup = useUpdateGroup(cn);
  const deleteGroup = useDeleteGroup();
  const addMember = useAddGroupMember(cn);
  const removeMember = useRemoveGroupMember(cn);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // member_dns → User[] resolution (paralel fetch)
  const [memberUsers, setMemberUsers] = useState<Record<string, User | null>>(
    {},
  );
  useEffect(() => {
    if (!group) return;
    const uids = group.member_dns
      .map((dn) => uidFromDn(dn))
      .filter((u): u is string => u !== null);
    // Sadece bilinmeyen UID'leri fetch et
    const unknown = uids.filter((u) => memberUsers[u] === undefined);
    if (unknown.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(
        unknown.map((u) =>
          usersApi
            .get(u)
            .then((user) => [u, user] as const)
            .catch(() => [u, null] as const),
        ),
      );
      if (cancelled) return;
      setMemberUsers((prev) => {
        const next = { ...prev };
        for (const [u, user] of fetched) next[u] = user;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.member_dns]);

  if (isLoading) {
    return <div className="py-12 text-center text-fg-subtle">{t("common:loading")}</div>;
  }
  if (isError || !group) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Grup yüklenemedi: {extractBackendError(error)}
      </div>
    );
  }

  const memberRows = group.member_dns
    .map((dn) => {
      const uid = uidFromDn(dn);
      const u = uid ? memberUsers[uid] : null;
      return { dn, uid, user: u };
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => navigate("/groups")}
            aria-label={t("detail.back")}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold text-fg">
                {group.cn}
              </h1>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg">
                {group.group_type}
              </span>
            </div>
            <div className="font-mono text-xs text-fg-subtle">{group.dn}</div>
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
            onClick={() => setDeleteOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 text-sm text-destructive hover:bg-destructive/15"
          >
            <Trash2 className="h-4 w-4" />
            {t("detail.delete")}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Grup Bilgileri
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-fg-subtle">
              Açıklama
            </dt>
            <dd className="text-sm text-fg">{group.description ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-fg-subtle">
              Tip
            </dt>
            <dd className="font-mono text-sm text-fg">{group.group_type}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-fg-subtle">
              Üye sayısı
            </dt>
            <dd className="font-mono text-sm text-fg">
              {(group.member_count ?? 0).toLocaleString("tr-TR")}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{t("detail.members")}</h2>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-subtle">
              {group.member_dns.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Üye ekle
          </button>
        </header>

        {memberRows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-fg-subtle">
            Bu grup henüz üye içermiyor.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {memberRows.map(({ dn, uid, user }) => (
              <li
                key={dn}
                className="flex items-center justify-between gap-3 px-4 py-2"
              >
                <div className="min-w-0 flex-1">
                  {uid ? (
                    <Link
                      to={`/users/${encodeURIComponent(uid)}`}
                      className="truncate font-mono text-sm text-primary hover:underline"
                    >
                      {uid}
                    </Link>
                  ) : (
                    <span className="truncate font-mono text-sm text-fg-subtle">
                      {dn}
                    </span>
                  )}
                  {user && (
                    <div className="truncate text-xs text-fg-subtle">
                      {user.cn || "—"}
                      {user.email && ` · ${user.email}`}
                    </div>
                  )}
                </div>
                {uid && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(uid)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg px-2 text-xs text-fg-subtle hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    Çıkar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t("detail.editTitle", { cn: group.cn })}
        size="lg"
      >
        <GroupForm
          mode="edit"
          initialValues={group}
          submitting={updateGroup.isPending}
          onCancel={() => setEditOpen(false)}
          onSubmit={async (values) => {
            await updateGroup.mutateAsync(values as GroupUpdatePayload);
            setEditOpen(false);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await deleteGroup.mutateAsync(group.cn);
          navigate("/groups");
        }}
        title="Grubu sil"
        description={
          <span>
            <span className="font-mono text-fg">{group.cn}</span> kalıcı olarak
            silinecek.
            {group.member_count > 0 && (
              <> <strong>{group.member_count}</strong> üye ataması kaldırılacak.</>
            )}
          </span>
        }
        confirmLabel={t("detail.delete")}
        variant="danger"
        confirmText={group.cn}
      />

      <MemberPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        existingMemberDns={group.member_dns}
        onSelect={async (uid) => {
          await addMember.mutateAsync(uid);
        }}
        title={`${group.cn} grubuna üye ekle`}
      />

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={async () => {
          if (!confirmRemove) return;
          await removeMember.mutateAsync(confirmRemove);
        }}
        title={t("detail.removeMemberTitle")}
        description={
          confirmRemove && (
            <span>
              <span className="font-mono text-fg">{confirmRemove}</span>{" "}
              kullanıcısı <span className="font-mono text-fg">{group.cn}</span>{" "}
              grubundan çıkarılacak.
            </span>
          )
        }
        confirmLabel="Çıkar"
        variant="danger"
      />
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend GroupCreateRequest: cn, description, group_type (groupOfNames|posixGroup), member_uids[]
// Backend GroupUpdateRequest: description (only!)

import { FormEvent, useState } from "react";
import type {
  Group,
  GroupCreatePayload,
  GroupUpdatePayload,
  GroupType,
} from "@/types/group";

import { useTranslation } from "react-i18next";
export type GroupFormMode = "create" | "edit";

export interface GroupFormProps {
  mode: GroupFormMode;
  initialValues?: Partial<Group>;
  onSubmit: (
    values: GroupCreatePayload | GroupUpdatePayload,
  ) => void | Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

const CN_PATTERN = /^[a-zA-Z][a-zA-Z0-9._\- ]{1,62}[a-zA-Z0-9]$/;

const TYPES: { value: GroupType; label: string; desc: string }[] = [
  {
    value: "groupOfNames",
    label: "groupOfNames",
    desc: "groups:form.memberDnDesc",
  },
  {
    value: "posixGroup",
    label: "posixGroup",
    desc: "groups:form.memberUidDesc",
  },
];

export function GroupForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
}: GroupFormProps) {
  const { t } = useTranslation("common");
  const [cn, setCn] = useState(initialValues?.cn ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [groupType, setGroupType] = useState<GroupType>(
    (initialValues?.group_type as GroupType) ?? "groupOfNames",
  );

  const [errors, setErrors] = useState<{
    cn?: string;
    description?: string;
  }>({});

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (mode === "create") {
      if (!cn) next.cn = "CN zorunludur.";
      else if (!CN_PATTERN.test(cn))
        next.cn =
          t("groups:form.cnRule");
    }
    if (description && description.length > 512)
      next.description = t("groups:form.descLimit");
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (mode === "create") {
      const payload: GroupCreatePayload = {
        cn: cn.trim(),
        description: description.trim() || null,
        group_type: groupType,
      };
      await onSubmit(payload);
    } else {
      // Update sadece description destekliyor
      const payload: GroupUpdatePayload = {
        description: description.trim() || null,
      };
      await onSubmit(payload);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">
          CN<span className="text-destructive">*</span>
        </span>
        <input
          type="text"
          value={cn}
          disabled={mode === "edit"}
          onChange={(e) => setCn(e.target.value)}
          placeholder="developers"
          className={[
            "block w-full rounded-md border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-subtle",
            "focus:outline-none focus:ring-2 focus:ring-primary/50",
            "disabled:cursor-not-allowed disabled:opacity-60",
            errors.cn ? "border-destructive" : "border-border",
          ].join(" ")}
        />
        {errors.cn ? (
          <span className="mt-1 block text-xs text-destructive">{errors.cn}</span>
        ) : mode === "edit" ? (
          <span className="mt-1 block text-xs text-fg-subtle">
            {t("groups:form.cnLocked")}
          </span>
        ) : null}
      </label>

      <label className="block text-sm">
        <span className="mb-1 inline-block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          {t("groups:form.description")}
        </span>
        <textarea
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={512}
          className={[
            "block w-full rounded-md border bg-bg px-3 py-2 text-sm text-fg",
            "focus:outline-none focus:ring-2 focus:ring-primary/50",
            errors.description ? "border-destructive" : "border-border",
          ].join(" ")}
        />
        {errors.description && (
          <span className="mt-1 block text-xs text-destructive">
            {errors.description}
          </span>
        )}
      </label>

      {mode === "create" && (
        <div className="space-y-2">
          <span className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            {t("groups:form.groupType")}
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setGroupType(t.value)}
                className={[
                  "rounded-md border px-3 py-2 text-left text-sm transition",
                  groupType === t.value
                    ? "border-primary bg-primary/5"
                    : "border-border bg-bg hover:bg-muted",
                ].join(" ")}
              >
                <div className="font-mono font-medium text-fg">{t.label}</div>
                <div className="text-xs text-fg-subtle">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>
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
          {submitting ? t("common:saving") : mode === "create" ? t("groups:form.create") : t("common:save")}
        </button>
      </div>
    </form>
  );
}

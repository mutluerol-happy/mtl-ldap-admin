// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { AdminForm } from "@/components/admin/AdminForm";
import { useCreateAdmin } from "@/hooks/useAdmins";
import { useRolesList } from "@/hooks/useRoles";
import type { AdminCreatePayload } from "@/types/admin";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function AdminCreate() {
  const { t } = useTranslation(["admins", "common"]);
  const navigate = useNavigate();
  const createAdmin = useCreateAdmin();
  const { data: rolesData, isLoading: rolesLoading } = useRolesList();
  const [apiError, setApiError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate("/admins")}
          aria-label={t("detail.back")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-xl font-semibold text-fg">{t("newAdminTitle")}</h1>
      </div>

      {apiError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        {rolesLoading || !rolesData ? (
          <div className="py-12 text-center text-fg-subtle">
            {t("common:loading")}
          </div>
        ) : (
          <AdminForm
            mode="create"
            availableRoles={rolesData.items}
            onSubmit={async (values) => {
              setApiError(null);
              try {
                const admin = await createAdmin.mutateAsync(
                  values as AdminCreatePayload,
                );
                navigate(`/admins/${encodeURIComponent(admin.id)}`);
              } catch (e) {
                setApiError(extractBackendError(e));
              }
            }}
            onCancel={() => navigate("/admins")}
            submitting={createAdmin.isPending}
          />
        )}
      </div>
    </div>
  );
}

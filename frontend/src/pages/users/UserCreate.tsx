// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { UserForm } from "@/components/user/UserForm";
import { useCreateUser } from "@/hooks/useUsers";
import type { UserCreatePayload } from "@/types/user";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

export default function UserCreate() {
  const { t } = useTranslation("users");

  const navigate = useNavigate();
  const createUser = useCreateUser();
  const [apiError, setApiError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate("/users")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
          aria-label={t("detail.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-xl font-semibold text-fg">{t("newUserTitle")}</h1>
      </div>

      {apiError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <UserForm
          mode="create"
          onSubmit={async (values) => {
            setApiError(null);
            try {
              const user = await createUser.mutateAsync(
                values as UserCreatePayload,
              );
              navigate(`/users/${encodeURIComponent(user.uid)}`);
            } catch (e) {
              setApiError(extractBackendError(e));
            }
          }}
          onCancel={() => navigate("/users")}
          submitting={createUser.isPending}
        />
      </div>
    </div>
  );
}

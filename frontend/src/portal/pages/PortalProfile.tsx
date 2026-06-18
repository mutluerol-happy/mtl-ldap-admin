// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Save, User } from "lucide-react";
import { toast } from "sonner";

import { extractPortalError, portalApi } from "@/portal/lib/portalApi";
import { usePortalAuthStore } from "@/portal/lib/portalAuthStore";
import { useTranslation } from "react-i18next";

export default function PortalProfile() {
  const { t } = useTranslation("portal");
  const user = usePortalAuthStore((s) => s.user);
  const setUser = usePortalAuthStore((s) => s.setUser);

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [email, setEmail] = useState(user?.email ?? user?.mail ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // İlk yüklemede taze profil çek
  useEffect(() => {
    portalApi.getProfile().then((p) => {
      setUser(p);
      setDisplayName(p.display_name ?? "");
      setEmail(p.email ?? p.mail ?? "");
      setPhone(p.phone ?? "");
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    displayName !== (user?.display_name ?? "") ||
    email !== (user?.email ?? user?.mail ?? "") ||
    phone !== (user?.phone ?? "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      if (displayName !== (user?.display_name ?? "")) payload.display_name = displayName;
      if (email !== (user?.email ?? user?.mail ?? "")) payload.email = email;
      if (phone !== (user?.phone ?? "")) payload.phone = phone;
      const updated = await portalApi.updateProfile(payload);
      setUser(updated);
      toast.success(t("profile.updated"));
    } catch (err) {
      setError(extractPortalError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <User className="h-6 w-6 text-fg-subtle" />
        <div>
          <h1 className="text-xl font-semibold text-fg">Profil</h1>
          <p className="text-sm text-fg-subtle">
            {t("profile.subtitle")}
          </p>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="rounded-lg border border-border bg-card p-4 space-y-4"
      >
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        <Field
          label={t("profile.username")}
          value={user?.username ?? "—"}
          readOnly
          hint={t("profile.usernameHint")}
        />
        <EditField
          label={t("profile.displayName")}
          value={displayName}
          onChange={setDisplayName}
        />
        <EditField
          label={t("fields.email")}
          value={email}
          type="email"
          onChange={setEmail}
        />
        <EditField
          label={t("fields.phone")}
          value={phone}
          type="tel"
          onChange={setPhone}
          placeholder="+90..."
        />

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={loading || !dirty}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t("actions.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  readOnly,
  hint,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        className="block w-full rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm font-mono text-fg-subtle cursor-not-allowed"
      />
      {hint && (
        <p className="mt-1 text-[10px] text-fg-subtle">{hint}</p>
      )}
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-fg-subtle mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}

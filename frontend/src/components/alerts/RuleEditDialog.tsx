// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useState } from "react";

import { Modal } from "@/components/dialog/Modal";
import type { AlertRule, AlertRuleUpdatePayload, AlertSeverity } from "@/types/alert";
import { useUpdateAlertRule } from "@/hooks/useAlerts";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

const SEVERITIES: AlertSeverity[] = ["INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"];

export interface RuleEditDialogProps {
  open: boolean;
  rule: AlertRule | null;
  onClose: () => void;
}

export function RuleEditDialog({ open, rule, onClose }: RuleEditDialogProps) {
  const { t } = useTranslation(["alerts", "common"]);
  const updateMut = useUpdateAlertRule(rule?.id ?? "");
  const [enabled, setEnabled] = useState(true);
  const [severity, setSeverity] = useState<AlertSeverity>("WARNING");
  const [threshold, setThreshold] = useState(1);
  const [windowMin, setWindowMin] = useState(60);
  const [cooldownMin, setCooldownMin] = useState(60);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Modal her açıldığında değerleri sıfırla
  useEffect(() => {
    if (!rule || !open) return;
    setEnabled(rule.enabled);
    setSeverity((rule.severity as AlertSeverity) ?? "WARNING");
    setThreshold(rule.threshold_count);
    setWindowMin(rule.window_minutes);
    setCooldownMin(rule.cooldown_minutes);
    setDescription(rule.description ?? "");
    setError(null);
  }, [rule, open]);

  if (!rule) return null;

  const submit = async () => {
    if (!rule) return;
    setError(null);

    // Sadece değişen alanları gönder
    const payload: AlertRuleUpdatePayload = {};
    if (enabled !== rule.enabled) payload.enabled = enabled;
    if (severity !== rule.severity) payload.severity = severity;
    if (threshold !== rule.threshold_count) payload.threshold_count = threshold;
    if (windowMin !== rule.window_minutes) payload.window_minutes = windowMin;
    if (cooldownMin !== rule.cooldown_minutes) payload.cooldown_minutes = cooldownMin;
    const desc = description.trim();
    if (desc !== (rule.description ?? "")) {
      payload.description = desc || null;
    }

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    try {
      await updateMut.mutateAsync(payload);
      onClose();
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Kural: ${rule.name}`}
      description={
        <span className="font-mono text-xs">{rule.rule_code}</span>
      }
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={updateMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={updateMut.isPending}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {updateMut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
          <span className="text-fg-subtle">Tip: </span>
          <span className="font-mono text-fg">{rule.rule_type}</span>
          {rule.last_triggered_at && (
            <span className="ml-3">
              <span className="text-fg-subtle">Son tetik: </span>
              <span className="text-fg">
                {new Date(rule.last_triggered_at).toLocaleString("tr-TR")}
              </span>
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-fg">
            Kural <strong>{enabled ? "aktif" : "pasif"}</strong>
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Severity">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as AlertSeverity)}
              className={inputCls}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Threshold (count)"
            hint={t("ruleEdit.thresholdHint")}
          >
            <input
              type="number"
              min={1}
              max={10000}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className={inputCls + " font-mono"}
            />
          </Field>
          <Field
            label="Window (dk)"
            hint={t("ruleEdit.windowHint")}
          >
            <input
              type="number"
              min={1}
              max={10080}
              value={windowMin}
              onChange={(e) => setWindowMin(Number(e.target.value))}
              className={inputCls + " font-mono"}
            />
          </Field>
        </div>

        <Field
          label="Cooldown (dk)"
          hint={t("ruleEdit.cooldownHint")}
        >
          <input
            type="number"
            min={0}
            max={1440}
            value={cooldownMin}
            onChange={(e) => setCooldownMin(Number(e.target.value))}
            className={inputCls + " font-mono"}
          />
        </Field>

        <Field label={t("ruleEdit.descLabel")}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={512}
            placeholder={t("ruleEdit.descPlaceholder")}
            className={inputCls + " resize-none"}
          />
        </Field>

        {rule.notify_channels.length > 0 && (
          <div className="rounded-md border border-border bg-bg p-2 text-xs">
            <span className="text-fg-subtle">{t("ruleEdit.channels")}: </span>
            {rule.notify_channels.map((c) => (
              <span
                key={c}
                className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-fg"
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

const inputCls =
  "block w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/50";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-subtle">{hint}</span>}
    </label>
  );
}

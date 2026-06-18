// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, FileUp, Info } from "lucide-react";
import { useImportUsersCsv } from "@/hooks/useBulkJob";
import { bulkApi } from "@/lib/api.tur7-additions";
import { extractBackendError } from "@/types/common";
import { useTranslation } from "react-i18next";

/**
 * Backend bulk endpoint'leri:
 *   POST /users/bulk/csv (multipart) — KULLANILIYOR
 *   POST /users/bulk (JSON items[])  — bu sayfa CSV kullanır
 *   GET  /users/bulk/{job_id}        — durum
 *   Grup için bulk endpoint YOK.
 */
export default function BulkImport() {
  const { t } = useTranslation("bulk");
  const navigate = useNavigate();
  const location = useLocation();
  const isGroups = location.pathname.startsWith("/groups");

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importUsersMut = useImportUsersCsv();

  const onPick = (f: File | null) => {
    setFile(f);
    setError(null);
  };

  const onSubmit = async () => {
    if (!file) return;
    setError(null);
    try {
      if (isGroups) {
        // Backend'de yok — pre-checked üst banner gösteriliyor zaten
        await bulkApi.importGroupsCsv(file);
        return;
      }
      const job = await importUsersMut.mutateAsync(file);
      navigate(`/bulk/jobs/${encodeURIComponent(job.id)}`);
    } catch (e) {
      setError(extractBackendError(e));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(isGroups ? "/groups" : "/users")}
          aria-label="Geri"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-xl font-semibold text-fg">
          {isGroups ? t("import.titleGroups") : t("import.titleUsers")}
        </h1>
      </div>

      {isGroups && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-medium">{t("import.notSupportedTitle")}</div>
            <div className="text-xs">
              {t("import.notSupportedHint")}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-2 text-sm font-semibold text-fg">{t("import.csvUpload")}</h2>
        <p className="mb-4 text-sm text-fg-subtle">
          Kullanıcılar için CSV: <code className="font-mono">uid, cn, sn, given_name, email, phone, title, department, password, must_change_password, preferred_language</code>.
          {t("import.csvHeaderHint")}
        </p>

        <label
          htmlFor="csvfile"
          className={[
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-10 text-center transition",
            file
              ? "border-primary/40 bg-primary/5"
              : "border-border bg-bg hover:border-primary/40 hover:bg-primary/5",
            isGroups ? "pointer-events-none opacity-50" : "",
          ].join(" ")}
        >
          <FileUp className="h-6 w-6 text-fg-subtle" />
          {file ? (
            <div>
              <div className="text-sm font-medium text-fg">{file.name}</div>
              <div className="text-xs text-fg-subtle">
                {(file.size / 1024).toFixed(1)} KB
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm text-fg">{t("import.selectCsv")}</div>
              <div className="text-xs text-fg-subtle">
                {t("import.orDrag")}
              </div>
            </div>
          )}
          <input
            id="csvfile"
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            disabled={isGroups}
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            disabled={!file || importUsersMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            Temizle
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!file || importUsersMut.isPending || isGroups}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {importUsersMut.isPending ? t("import.uploading") : t("import.uploadAndStart")}
          </button>
        </div>
      </div>
    </div>
  );
}

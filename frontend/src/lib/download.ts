// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

export function downloadText(filename: string, content: string, mime = "application/x-pem-file"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

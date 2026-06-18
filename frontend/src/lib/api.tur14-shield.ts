// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend Tur 14 — shield (sertifika/TLS) API çağrıları.
// apiClient.baseURL = "/api/v1" — path'lere prefix EKLEMEYIZ.

import type {
  CaExportResponse,
  CaResignPayload,
  Certificate,
  CertActivateResponse,
  CertificateDetail,
  CertUploadPayload,
  Csr,
  CsrGeneratePayload,
  CsrGenerateResponse,
  ShieldOverview,
  TransitionActivatePayload,
} from "@/types/shield";

import { apiClient } from "./api";

export const shieldApi = {
  overview: () =>
    apiClient.get<ShieldOverview>("/shield/overview").then((r) => r.data),

  listCertificates: () =>
    apiClient.get<Certificate[]>("/shield/certificates").then((r) => r.data),

  getCertificate: (id: string) =>
    apiClient
      .get<CertificateDetail>(`/shield/certificates/${encodeURIComponent(id)}`)
      .then((r) => r.data),

  uploadCertificate: (payload: CertUploadPayload) =>
    apiClient
      .post<Certificate>("/shield/certificates", payload)
      .then((r) => r.data),

  deleteCertificate: (id: string) =>
    apiClient
      .delete(`/shield/certificates/${encodeURIComponent(id)}`)
      .then(() => undefined),

  activateCertificate: (id: string) =>
    apiClient
      .post<CertActivateResponse>(
        `/shield/certificates/${encodeURIComponent(id)}/activate`,
      )
      .then((r) => r.data),

  transitionActivate: (payload: TransitionActivatePayload) =>
    apiClient
      .post<CertActivateResponse>("/shield/transition/activate", payload)
      .then((r) => r.data),

  listCsr: () => apiClient.get<Csr[]>("/shield/csr").then((r) => r.data),

  generateCsr: (payload: CsrGeneratePayload) =>
    apiClient
      .post<CsrGenerateResponse>("/shield/csr", payload)
      .then((r) => r.data),

  resignCsr: (csrId: string, payload: CaResignPayload) =>
    apiClient
      .post<Certificate>(
        `/shield/csr/${encodeURIComponent(csrId)}/resign`,
        payload,
      )
      .then((r) => r.data),

  exportCa: () =>
    apiClient.get<CaExportResponse>("/shield/ca/export").then((r) => r.data),
};

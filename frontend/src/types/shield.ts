// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol
//
// Backend: app/schemas/shield.py

export type CertType = "SERVER" | "CA" | "CLIENT";
export type CertSource = "UPLOAD" | "GENERATED" | "INSTALLER" | "RESIGNED";

export interface Certificate {
  id: string;
  name: string;
  type: string; // CertType
  serial_number: string;
  subject: string;
  issuer: string;
  not_before: string;
  not_after: string;
  fingerprint_sha256: string;
  is_active: boolean;
  has_private_key: boolean;
  description: string | null;
  source: string; // CertSource
  activated_at: string | null;
  uploaded_at: string;
  days_remaining: number | null;
  is_expired: boolean | null;
  is_self_signed: boolean | null;
}

export interface CertificateDetail extends Certificate {
  pem_data: string;
}

export interface CertUploadPayload {
  name: string;
  type: CertType;
  pem: string;
  private_key?: string | null;
  csr_id?: string | null;
  description?: string | null;
}

export interface CertActivateResponse {
  certificate: Certificate;
  slapd_reloaded: boolean;
  nginx_reloaded: boolean;
  ca_trust_updated: boolean;
  live_ldaps_fingerprint: string | null;
  live_https_fingerprint: string | null;
  message: string;
  replication_warning: string | null;
}

export interface LiveEndpointStatus {
  name: string; // "ldaps" | "https"
  host: string;
  port: number;
  reachable: boolean;
  fingerprint_sha256: string | null;
  matches_active: boolean | null;
  error: string | null;
}

export interface ShieldOverview {
  active_ca: Certificate | null;
  active_server: Certificate | null;
  total_certificates: number;
  pending_csr: number;
  endpoints: LiveEndpointStatus[];
  warnings: string[];
}

export interface Csr {
  id: string;
  name: string;
  subject: string;
  status: string; // PENDING | FULFILLED | CANCELLED
  key_fingerprint: string | null;
  fulfilled_cert_id: string | null;
  created_at: string;
  fulfilled_at: string | null;
}

export interface CsrGeneratePayload {
  name: string;
  common_name: string;
  organization: string;
  country: string;
  san_dns: string[];
  san_ip: string[];
  key_bits: 2048 | 4096;
}

export interface CsrGenerateResponse {
  csr: Csr;
  csr_pem: string;
}

export interface CaExportResponse {
  name: string;
  pem: string;
  fingerprint_sha256: string;
  subject: string;
  not_after: string;
  note: string;
}

export interface CaResignPayload {
  name: string;
  description?: string | null;
  days: number;
}

export interface TransitionActivatePayload {
  ca_id: string;
  server_id: string;
}

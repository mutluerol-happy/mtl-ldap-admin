// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { shieldApi } from "@/lib/api.tur14-shield";
import type {
  CaResignPayload,
  CertUploadPayload,
  CsrGeneratePayload,
  TransitionActivatePayload,
} from "@/types/shield";

export const shieldKeys = {
  all: ["shield"] as const,
  overview: () => [...shieldKeys.all, "overview"] as const,
  certificates: () => [...shieldKeys.all, "certificates"] as const,
  certificate: (id: string) => [...shieldKeys.all, "certificate", id] as const,
  csr: () => [...shieldKeys.all, "csr"] as const,
};

export function useShieldOverview() {
  return useQuery({
    queryKey: shieldKeys.overview(),
    queryFn: () => shieldApi.overview(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useCertificates() {
  return useQuery({
    queryKey: shieldKeys.certificates(),
    queryFn: () => shieldApi.listCertificates(),
    staleTime: 15_000,
  });
}

export function useCsrList() {
  return useQuery({
    queryKey: shieldKeys.csr(),
    queryFn: () => shieldApi.listCsr(),
    staleTime: 15_000,
  });
}

function useInvalidateShield() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: shieldKeys.overview() });
    qc.invalidateQueries({ queryKey: shieldKeys.certificates() });
    qc.invalidateQueries({ queryKey: shieldKeys.csr() });
  };
}

export function useUploadCertificate() {
  const invalidate = useInvalidateShield();
  return useMutation({
    mutationFn: (payload: CertUploadPayload) => shieldApi.uploadCertificate(payload),
    onSuccess: invalidate,
  });
}

export function useDeleteCertificate() {
  const invalidate = useInvalidateShield();
  return useMutation({
    mutationFn: (id: string) => shieldApi.deleteCertificate(id),
    onSuccess: invalidate,
  });
}

export function useActivateCertificate() {
  const invalidate = useInvalidateShield();
  return useMutation({
    mutationFn: (id: string) => shieldApi.activateCertificate(id),
    onSuccess: invalidate,
  });
}

export function useTransitionActivate() {
  const invalidate = useInvalidateShield();
  return useMutation({
    mutationFn: (payload: TransitionActivatePayload) => shieldApi.transitionActivate(payload),
    onSuccess: invalidate,
  });
}

export function useGenerateCsr() {
  const invalidate = useInvalidateShield();
  return useMutation({
    mutationFn: (payload: CsrGeneratePayload) => shieldApi.generateCsr(payload),
    onSuccess: invalidate,
  });
}

export function useResignCsr() {
  const invalidate = useInvalidateShield();
  return useMutation({
    mutationFn: ({ csrId, payload }: { csrId: string; payload: CaResignPayload }) =>
      shieldApi.resignCsr(csrId, payload),
    onSuccess: invalidate,
  });
}

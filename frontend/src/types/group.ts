// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

export type GroupType = "groupOfNames" | "posixGroup";

export interface Group {
  cn: string;
  dn: string;
  description: string | null;
  group_type: GroupType | string;
  member_dns: string[];
  member_count: number;
}

export interface GroupCreatePayload {
  cn: string;
  description?: string | null;
  group_type?: GroupType;
  member_uids?: string[];
}

export interface GroupUpdatePayload {
  description?: string | null;
}

export type GroupListQuery = {
  page?: number;
  page_size?: number;
  search?: string;
};

/** "uid=alice,ou=people,dc=mtl,dc=local" → "alice" */
export function uidFromDn(dn: string): string | null {
  const m = dn.match(/^uid=([^,]+)/i);
  return m ? m[1] : null;
}

export const GROUP_TYPE_LABELS: Record<string, string> = {
  groupOfNames: "groupOfNames",
  posixGroup: "posixGroup",
};

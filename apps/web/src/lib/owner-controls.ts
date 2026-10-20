import { apiFetch } from "./api";

export interface AccountSession {
  id: string;
  businessId: string;
  expiresAt: string;
  current: boolean;
}

export interface OwnerControlSummary {
  totalMembers: number;
  staffMembers: number;
  ownerSeats: number;
  activeBranches: number;
}

export function ownerControlSummary(
  members: Array<{ role: string }>,
  branches: Array<{ isActive: boolean }>,
): OwnerControlSummary {
  return {
    totalMembers: members.length,
    staffMembers: members.filter((member) => member.role !== "owner").length,
    ownerSeats: members.filter((member) => member.role === "owner").length,
    activeBranches: branches.filter((branch) => branch.isActive).length,
  };
}

export function canRevokeAccountSession(session: AccountSession): boolean {
  // The current session is deliberately excluded: the normal sign-out flow
  // handles it, including its local query cache and offline sync scope.
  return !session.current;
}

type OwnerApiCall = <T>(
  path: string,
  options?: { csrfToken?: string; init?: RequestInit },
) => Promise<T>;

export async function revokeAccountSession(id: string, api: OwnerApiCall = apiFetch): Promise<void> {
  const { csrfToken } = await api<{ csrfToken: string }>("/api/v1/auth/csrf");
  await api<{ ok: boolean }>(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, {
    csrfToken,
    init: { method: "DELETE" },
  });
}

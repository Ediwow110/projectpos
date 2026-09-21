import { deriveTenantFromMembership, isSessionExpired, isSessionRevoked } from "@pos/auth";

export interface AuthorizeInput {
  membershipBusinessId: string | null;
  claimedBusinessId: string | null;
  expiresAt?: Date;
  revokedAt?: Date | null;
}

export function authorize(input: AuthorizeInput): string {
  if (input.expiresAt && isSessionExpired(input.expiresAt)) throw new Error("SESSION_EXPIRED");
  if (isSessionRevoked(input.revokedAt ?? null)) throw new Error("SESSION_REVOKED");
  const tenant = deriveTenantFromMembership(input.membershipBusinessId);
  if (input.claimedBusinessId !== null && input.claimedBusinessId !== tenant) {
    throw new Error("TENANT_MISMATCH");
  }
  return tenant;
}

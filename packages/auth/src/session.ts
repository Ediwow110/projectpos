export interface SessionRecord {
  expiresAt: Date;
  revokedAt: Date | null;
}

export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function isSessionRevoked(revokedAt: Date | null): boolean {
  return revokedAt !== null;
}

export function deriveTenantFromMembership(membershipBusinessId: string | null): string {
  if (!membershipBusinessId) throw new Error("TENANT_REQUIRED");
  return membershipBusinessId;
}

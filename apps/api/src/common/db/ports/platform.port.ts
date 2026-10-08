import type {
  DbUser,
  DbBusiness,
  DbMembership,
  DbReceiptDelivery,
  DbManagerApprovalGrant,
  DbSession,
  DbResetToken,
  AuditEntry,
  DbShiftCorrection,
} from "../types";

import type { DbPort } from "../port";

export interface PlatformPort {
  // Phase 12: the critical-section primitives. Memory serializes per key with
  // a promise chain (atomic by construction); PostgreSQL takes a
  // transaction-scoped advisory lock so the locked body commits as one unit
  // and is mutually exclusive across processes.
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  withTransaction<T>(fn: (db: DbPort) => Promise<T>): Promise<T>;
  findUserByEmail(email: string): Promise<DbUser | null>;
  findUserById(id: string): Promise<DbUser | null>;
  createUser(u: Omit<DbUser, "id">): Promise<DbUser>;
  updateUserPassword(id: string, passwordHash: string): Promise<void>;
  setUserEmailVerified(id: string, verified: boolean): Promise<void>;
  setUserWorkspaceTourSeen(id: string, seen: boolean): Promise<void>;
  createBusiness(b: Omit<DbBusiness, "id">): Promise<DbBusiness>;
  findBusinessById(id: string): Promise<DbBusiness | null>;
  listMembershipsByUser(userId: string): Promise<DbMembership[]>;
  findMembership(userId: string, businessId: string): Promise<DbMembership | null>;
  createMembership(m: Omit<DbMembership, "id">): Promise<DbMembership>;
  updateMembership(
    id: string,
    businessId: string,
    patch: { deactivatedAt?: Date | null; approvalPinHash?: string | null },
  ): Promise<void>;
  createSession(s: Omit<DbSession, "id">): Promise<DbSession>;
  findSessionByTokenHash(tokenHash: string): Promise<DbSession | null>;
  listSessionsByUser(userId: string): Promise<DbSession[]>;
  updateSession(
    id: string,
    patch: { activeBusinessId?: string | null; activeBranchId?: string | null; authenticatedAt?: Date },
  ): Promise<void>;
  revokeSession(id: string): Promise<void>;
  revokeAllUserSessions(userId: string, exceptId?: string): Promise<void>;
  saveResetToken(t: DbResetToken): Promise<void>;
  findResetToken(tokenHash: string): Promise<DbResetToken | null>;
  markResetTokenUsed(tokenHash: string, usedAt: Date): Promise<void>;
  createEmailVerificationToken(t: { userId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }>;
  findEmailVerificationToken(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null>;
  markEmailVerificationTokenUsed(id: string): Promise<void>;
  createSupportGrant(g: { purpose: string; actorId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }>;
  findValidSupportGrant(tokenHash: string): Promise<{ id: string; purpose: string; actorId: string; expiresAt: Date } | null>;
  markSupportGrantUsed(id: string): Promise<void>;
  createManagerApprovalGrant(g: Omit<DbManagerApprovalGrant, "id" | "usedAt">): Promise<{ id: string }>;
  findValidManagerApprovalGrant(
    tokenHash: string,
    businessId: string,
    requesterId: string,
    permission: string,
  ): Promise<Pick<DbManagerApprovalGrant, "id" | "approverId" | "fingerprint" | "expiresAt"> | null>;
  markManagerApprovalGrantUsed(id: string): Promise<void>;
  createShiftCorrection(c: { businessId: string; shiftId: string; amountMinor: number; reason: string; actorId: string; requestId: string }): Promise<DbShiftCorrection>;
  listShiftCorrections(businessId: string, shiftId: string): Promise<DbShiftCorrection[]>;
  createReceiptShare(s: { businessId: string; saleId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }>;
  findValidReceiptShare(tokenHash: string): Promise<{ id: string; businessId: string; saleId: string; expiresAt: Date } | null>;
  claimReceiptDelivery(d: Omit<DbReceiptDelivery, "id" | "createdAt">): Promise<{ delivery: DbReceiptDelivery; claimed: boolean }>;
  updateReceiptDelivery(id: string, businessId: string, patch: Partial<Omit<DbReceiptDelivery, "id" | "businessId" | "saleId" | "channel" | "recipient" | "idempotencyKey" | "createdAt">>): Promise<DbReceiptDelivery | null>;
  listReceiptDeliveries(businessId: string, saleId: string): Promise<DbReceiptDelivery[]>;
  getSettings(businessId: string): Promise<Record<string, unknown>>;
  saveSettings(businessId: string, settings: Record<string, unknown>): Promise<void>;
  appendAudit(e: AuditEntry): Promise<void>;
  listAudit(): Promise<AuditEntry[]>;
}

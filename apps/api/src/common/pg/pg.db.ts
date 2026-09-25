import type { AuditEntry, DbBusiness, DbPlan, DbMembership, DbPort, DbResetToken, DbSession, DbUser } from "../db.port";
import { PgContext } from "./context";
import { settingsFamily } from "./pg-settings";
import { auditFamily } from "./pg-audit";
import { tenantsFamily } from "./pg-tenants";

// Phase 12: the PostgreSQL-backed DbPort. Composed from per-family modules
// over one PgContext. Becomes `implements DbPort` complete in the Task 13
// boot swap; until then only landed families exist and the harness casts.
export class PgDbPort {
  private readonly settings: ReturnType<typeof settingsFamily>;
  private readonly audit: ReturnType<typeof auditFamily>;
  private readonly tenants: ReturnType<typeof tenantsFamily>;

  constructor(private readonly ctx: PgContext) {
    this.settings = settingsFamily(ctx);
    this.audit = auditFamily(ctx);
    this.tenants = tenantsFamily(ctx);
  }

  // withLock/withTransaction come straight from the context so every family
  // shares the transaction scope.
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.ctx.withLock(key, fn);
  }
  withTransaction<T>(fn: (ctx: PgContext) => Promise<T>): Promise<T> {
    return this.ctx.withTransaction(fn);
  }
  async close(): Promise<void> {
    await this.ctx.close();
  }

  getSettings(businessId: string): Promise<Record<string, unknown>> {
    return this.settings.getSettings(businessId);
  }
  saveSettings(businessId: string, settings: Record<string, unknown>): Promise<void> {
    return this.settings.saveSettings(businessId, settings);
  }
  appendAudit(e: AuditEntry): Promise<void> {
    return this.audit.appendAudit(e);
  }
  listAudit(): Promise<AuditEntry[]> {
    return this.audit.listAudit();
  }

  // Tenants family: users, businesses, memberships, sessions, reset and
  // email-verification tokens (createBusiness/findBusinessById moved here
  // from this file so the family is the single implementation).
  findUserByEmail(email: string): Promise<DbUser | null> {
    return this.tenants.findUserByEmail(email);
  }
  findUserById(id: string): Promise<DbUser | null> {
    return this.tenants.findUserById(id);
  }
  createUser(u: Omit<DbUser, "id">): Promise<DbUser> {
    return this.tenants.createUser(u);
  }
  updateUserPassword(id: string, passwordHash: string): Promise<void> {
    return this.tenants.updateUserPassword(id, passwordHash);
  }
  setUserEmailVerified(id: string, verified: boolean): Promise<void> {
    return this.tenants.setUserEmailVerified(id, verified);
  }
  createBusiness(b: Omit<DbBusiness, "id">): Promise<DbBusiness> {
    return this.tenants.createBusiness(b);
  }
  findBusinessById(id: string): Promise<DbBusiness | null> {
    return this.tenants.findBusinessById(id);
  }
  listMembershipsByUser(userId: string): Promise<DbMembership[]> {
    return this.tenants.listMembershipsByUser(userId);
  }
  listMembershipsByBusiness(businessId: string): Promise<DbMembership[]> {
    return this.tenants.listMembershipsByBusiness(businessId);
  }
  findMembership(userId: string, businessId: string): Promise<DbMembership | null> {
    return this.tenants.findMembership(userId, businessId);
  }
  createMembership(m: Omit<DbMembership, "id">): Promise<DbMembership> {
    return this.tenants.createMembership(m);
  }
  updateMembership(id: string, businessId: string, patch: { deactivatedAt: Date | null }): Promise<void> {
    return this.tenants.updateMembership(id, businessId, patch);
  }
  createSession(s: Omit<DbSession, "id">): Promise<DbSession> {
    return this.tenants.createSession(s);
  }
  findSessionByTokenHash(tokenHash: string): Promise<DbSession | null> {
    return this.tenants.findSessionByTokenHash(tokenHash);
  }
  listSessionsByUser(userId: string): Promise<DbSession[]> {
    return this.tenants.listSessionsByUser(userId);
  }
  updateSession(id: string, patch: { activeBusinessId: string | null }): Promise<void> {
    return this.tenants.updateSession(id, patch);
  }
  revokeSession(id: string): Promise<void> {
    return this.tenants.revokeSession(id);
  }
  revokeAllUserSessions(userId: string, exceptId?: string): Promise<void> {
    return this.tenants.revokeAllUserSessions(userId, exceptId);
  }
  saveResetToken(t: DbResetToken): Promise<void> {
    return this.tenants.saveResetToken(t);
  }
  findResetToken(tokenHash: string): Promise<DbResetToken | null> {
    return this.tenants.findResetToken(tokenHash);
  }
  markResetTokenUsed(tokenHash: string, usedAt: Date): Promise<void> {
    return this.tenants.markResetTokenUsed(tokenHash, usedAt);
  }
  createEmailVerificationToken(t: { userId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }> {
    return this.tenants.createEmailVerificationToken(t);
  }
  findEmailVerificationToken(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null> {
    return this.tenants.findEmailVerificationToken(tokenHash);
  }
  markEmailVerificationTokenUsed(id: string): Promise<void> {
    return this.tenants.markEmailVerificationTokenUsed(id);
  }

  async listPlans(): Promise<DbPlan[]> {
    const c = await this.ctx.client();
    try {
      const r = await c.query('SELECT "id", "key", "name", "allowances", "pricesMinor", "isActive" FROM "Plan" ORDER BY "key" ASC');
      return r.rows as DbPlan[];
    } finally {
      if (this.ctx.owns()) c.release();
    }
  }
  async findPlanByKey(key: string): Promise<DbPlan | null> {
    const c = await this.ctx.client();
    try {
      const r = await c.query('SELECT "id", "key", "name", "allowances", "pricesMinor", "isActive" FROM "Plan" WHERE "key" = $1', [key]);
      return (r.rows[0] as DbPlan | undefined) ?? null;
    } finally {
      if (this.ctx.owns()) c.release();
    }
  }
}

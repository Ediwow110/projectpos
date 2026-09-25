import type { AuditEntry, DbBalance, DbBusiness, DbCategory, DbMovement, DbPlan, DbMembership, DbPort, DbProduct, DbResetToken, DbSession, DbUser } from "../db.port";
import { PgContext } from "./context";
import { settingsFamily } from "./pg-settings";
import { auditFamily } from "./pg-audit";
import { tenantsFamily } from "./pg-tenants";
import { catalogFamily } from "./pg-catalog";
import { inventoryFamily } from "./pg-inventory";

// Phase 12: the PostgreSQL-backed DbPort. Composed from per-family modules
// over one PgContext. Becomes `implements DbPort` complete in the Task 13
// boot swap; until then only landed families exist and the harness casts.
export class PgDbPort {
  private readonly settings: ReturnType<typeof settingsFamily>;
  private readonly audit: ReturnType<typeof auditFamily>;
  private readonly tenants: ReturnType<typeof tenantsFamily>;
  private readonly catalog: ReturnType<typeof catalogFamily>;
  private readonly inventory: ReturnType<typeof inventoryFamily>;

  constructor(private readonly ctx: PgContext) {
    this.settings = settingsFamily(ctx);
    this.audit = auditFamily(ctx);
    this.tenants = tenantsFamily(ctx);
    this.catalog = catalogFamily(ctx);
    this.inventory = inventoryFamily(ctx);
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

  // Catalog family: categories and products.
  createCategory(c: Omit<DbCategory, "id">): Promise<DbCategory> {
    return this.catalog.createCategory(c);
  }
  listCategories(businessId: string): Promise<DbCategory[]> {
    return this.catalog.listCategories(businessId);
  }
  findCategoryById(id: string, businessId: string): Promise<DbCategory | null> {
    return this.catalog.findCategoryById(id, businessId);
  }
  updateCategory(id: string, businessId: string, patch: Partial<Omit<DbCategory, "id" | "businessId">>): Promise<DbCategory | null> {
    return this.catalog.updateCategory(id, businessId, patch);
  }
  createProduct(p: Omit<DbProduct, "id">): Promise<DbProduct> {
    return this.catalog.createProduct(p);
  }
  listProducts(businessId: string): Promise<DbProduct[]> {
    return this.catalog.listProducts(businessId);
  }
  findProductById(id: string, businessId: string): Promise<DbProduct | null> {
    return this.catalog.findProductById(id, businessId);
  }
  updateProduct(id: string, businessId: string, patch: Partial<Omit<DbProduct, "id" | "businessId">>): Promise<DbProduct | null> {
    return this.catalog.updateProduct(id, businessId, patch);
  }

  // Inventory family: the append-only movement ledger and balance projection.
  createMovement(m: Omit<DbMovement, "id">): Promise<DbMovement> {
    return this.inventory.createMovement(m);
  }
  listMovements(productId: string, businessId: string, branchId?: string | null): Promise<DbMovement[]> {
    return this.inventory.listMovements(productId, businessId, branchId);
  }
  listMovementsByBusiness(businessId: string): Promise<DbMovement[]> {
    return this.inventory.listMovementsByBusiness(businessId);
  }
  listMovementsPage(businessId: string, afterId: string | null, limit: number): Promise<DbMovement[]> {
    return this.inventory.listMovementsPage(businessId, afterId, limit);
  }
  upsertBalance(b: Omit<DbBalance, "id">): Promise<DbBalance> {
    return this.inventory.upsertBalance(b);
  }
  findBalance(productId: string, businessId: string, branchId?: string | null): Promise<DbBalance | null> {
    return this.inventory.findBalance(productId, businessId, branchId);
  }
  listBalances(businessId: string): Promise<DbBalance[]> {
    return this.inventory.listBalances(businessId);
  }
}

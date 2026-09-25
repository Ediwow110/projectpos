import type { AuditEntry, DbBalance, DbBranch, DbBusiness, DbCashMovement, DbCategory, DbCustomer, DbExpense, DbHeldSale, DbIdempotency, DbMovement, DbPayment, DbPlan, DbMembership, DbPort, DbProduct, DbRefund, DbRefundItem, DbRegister, DbResetToken, DbSale, DbSaleItem, DbSession, DbShift, DbStockTransfer, DbStockTransferLine, DbUser } from "../db.port";
import { PgContext } from "./context";
import { settingsFamily } from "./pg-settings";
import { auditFamily } from "./pg-audit";
import { tenantsFamily } from "./pg-tenants";
import { catalogFamily } from "./pg-catalog";
import { inventoryFamily } from "./pg-inventory";
import { salesFamily } from "./pg-sales";
import { shiftsFamily } from "./pg-shifts";
import { peopleFamily } from "./pg-people";
import { branchesFamily } from "./pg-branches";

// Phase 12: the PostgreSQL-backed DbPort. Composed from per-family modules
// over one PgContext. Becomes `implements DbPort` complete in the Task 13
// boot swap; until then only landed families exist and the harness casts.
export class PgDbPort {
  private readonly settings: ReturnType<typeof settingsFamily>;
  private readonly audit: ReturnType<typeof auditFamily>;
  private readonly tenants: ReturnType<typeof tenantsFamily>;
  private readonly catalog: ReturnType<typeof catalogFamily>;
  private readonly inventory: ReturnType<typeof inventoryFamily>;
  private readonly sales: ReturnType<typeof salesFamily>;
  private readonly shifts: ReturnType<typeof shiftsFamily>;
  private readonly people: ReturnType<typeof peopleFamily>;
  private readonly branches: ReturnType<typeof branchesFamily>;

  constructor(private readonly ctx: PgContext) {
    this.settings = settingsFamily(ctx);
    this.audit = auditFamily(ctx);
    this.tenants = tenantsFamily(ctx);
    this.catalog = catalogFamily(ctx);
    this.inventory = inventoryFamily(ctx);
    this.sales = salesFamily(ctx);
    this.shifts = shiftsFamily(ctx);
    this.people = peopleFamily(ctx);
    this.branches = branchesFamily(ctx);
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

  // People family.
  createCustomer(c: Omit<DbCustomer, "id">): Promise<DbCustomer> {
    return this.people.createCustomer(c);
  }
  listCustomersByBusiness(businessId: string): Promise<DbCustomer[]> {
    return this.people.listCustomersByBusiness(businessId);
  }
  findCustomerById(id: string, businessId: string): Promise<DbCustomer | null> {
    return this.people.findCustomerById(id, businessId);
  }
  updateCustomer(id: string, businessId: string, patch: Partial<Omit<DbCustomer, "id" | "businessId">>): Promise<DbCustomer | null> {
    return this.people.updateCustomer(id, businessId, patch);
  }
  createRefund(r: Omit<DbRefund, "id">): Promise<DbRefund> {
    return this.people.createRefund(r);
  }
  listRefundsBySale(saleId: string, businessId: string): Promise<DbRefund[]> {
    return this.people.listRefundsBySale(saleId, businessId);
  }
  findRefundById(id: string, businessId: string): Promise<DbRefund | null> {
    return this.people.findRefundById(id, businessId);
  }
  createRefundItem(i: Omit<DbRefundItem, "id">): Promise<DbRefundItem> {
    return this.people.createRefundItem(i);
  }
  listRefundItems(refundId: string, businessId: string): Promise<DbRefundItem[]> {
    return this.people.listRefundItems(refundId, businessId);
  }
  listRefundItemsBySale(saleId: string, businessId: string): Promise<DbRefundItem[]> {
    return this.people.listRefundItemsBySale(saleId, businessId);
  }
  createExpense(e: Omit<DbExpense, "id">): Promise<DbExpense> {
    return this.people.createExpense(e);
  }
  listExpensesByBusiness(businessId: string): Promise<DbExpense[]> {
    return this.people.listExpensesByBusiness(businessId);
  }
  listExpensesPage(businessId: string, afterId: string | null, limit: number): Promise<DbExpense[]> {
    return this.people.listExpensesPage(businessId, afterId, limit);
  }
  findExpenseById(id: string, businessId: string): Promise<DbExpense | null> {
    return this.people.findExpenseById(id, businessId);
  }
  updateExpense(id: string, businessId: string, patch: Partial<Omit<DbExpense, "id" | "businessId">>): Promise<DbExpense | null> {
    return this.people.updateExpense(id, businessId, patch);
  }
  // Branches family.
  createBranch(b: Omit<DbBranch, "id">): Promise<DbBranch> {
    return this.branches.createBranch(b);
  }
  listBranchesByBusiness(businessId: string): Promise<DbBranch[]> {
    return this.branches.listBranchesByBusiness(businessId);
  }
  findBranchById(id: string, businessId: string): Promise<DbBranch | null> {
    return this.branches.findBranchById(id, businessId);
  }
  updateBranch(id: string, businessId: string, patch: Partial<Omit<DbBranch, "id" | "businessId">>): Promise<DbBranch | null> {
    return this.branches.updateBranch(id, businessId, patch);
  }
  createTransfer(t: Omit<DbStockTransfer, "id">): Promise<DbStockTransfer> {
    return this.branches.createTransfer(t);
  }
  findTransferById(id: string, businessId: string): Promise<DbStockTransfer | null> {
    return this.branches.findTransferById(id, businessId);
  }
  listTransfersByBusiness(businessId: string): Promise<DbStockTransfer[]> {
    return this.branches.listTransfersByBusiness(businessId);
  }
  updateTransfer(id: string, businessId: string, patch: Partial<Omit<DbStockTransfer, "id" | "businessId">>): Promise<DbStockTransfer | null> {
    return this.branches.updateTransfer(id, businessId, patch);
  }
  createTransferLine(l: Omit<DbStockTransferLine, "id">): Promise<DbStockTransferLine> {
    return this.branches.createTransferLine(l);
  }
  listTransferLines(transferId: string, businessId: string): Promise<DbStockTransferLine[]> {
    return this.branches.listTransferLines(transferId, businessId);
  }
  // Sales family.
  createSale(s: Omit<DbSale, "id">): Promise<DbSale> {
    return this.sales.createSale(s);
  }
  findSaleById(id: string, businessId: string): Promise<DbSale | null> {
    return this.sales.findSaleById(id, businessId);
  }
  listSalesByBusiness(businessId: string): Promise<DbSale[]> {
    return this.sales.listSalesByBusiness(businessId);
  }
  listSalesPage(businessId: string, afterId: string | null, limit: number): Promise<DbSale[]> {
    return this.sales.listSalesPage(businessId, afterId, limit);
  }
  updateSale(id: string, businessId: string, patch: Partial<Omit<DbSale, "id" | "businessId">>): Promise<DbSale | null> {
    return this.sales.updateSale(id, businessId, patch);
  }
  createSaleItem(i: Omit<DbSaleItem, "id">): Promise<DbSaleItem> {
    return this.sales.createSaleItem(i);
  }
  listSaleItems(saleId: string, businessId: string): Promise<DbSaleItem[]> {
    return this.sales.listSaleItems(saleId, businessId);
  }
  createPayment(p: Omit<DbPayment, "id">): Promise<DbPayment> {
    return this.sales.createPayment(p);
  }
  findPaymentById(id: string, businessId: string): Promise<DbPayment | null> {
    return this.sales.findPaymentById(id, businessId);
  }
  listPaymentsBySale(saleId: string, businessId: string): Promise<DbPayment[]> {
    return this.sales.listPaymentsBySale(saleId, businessId);
  }
  updatePayment(id: string, businessId: string, patch: Partial<Omit<DbPayment, "id" | "businessId">>): Promise<DbPayment | null> {
    return this.sales.updatePayment(id, businessId, patch);
  }
  createHeldSale(h: Omit<DbHeldSale, "id">): Promise<DbHeldSale> {
    return this.sales.createHeldSale(h);
  }
  findHeldSaleById(id: string, businessId: string): Promise<DbHeldSale | null> {
    return this.sales.findHeldSaleById(id, businessId);
  }
  listHeldSales(businessId: string, actorId: string): Promise<DbHeldSale[]> {
    return this.sales.listHeldSales(businessId, actorId);
  }
  markHeldResumed(id: string, businessId: string): Promise<void> {
    return this.sales.markHeldResumed(id, businessId);
  }
  claimIdempotency(r: DbIdempotency): Promise<void> {
    return this.sales.claimIdempotency(r);
  }
  findIdempotency(businessId: string, key: string, commandType: string): Promise<DbIdempotency | null> {
    return this.sales.findIdempotency(businessId, key, commandType);
  }
  findLatestSaleForRegister(businessId: string, registerId: string): Promise<DbSale | null> {
    return this.sales.findLatestSaleForRegister(businessId, registerId);
  }
  // Shifts family.
  createRegister(r: Omit<DbRegister, "id">): Promise<DbRegister> {
    return this.shifts.createRegister(r);
  }
  listRegisters(businessId: string): Promise<DbRegister[]> {
    return this.shifts.listRegisters(businessId);
  }
  findRegisterById(id: string, businessId: string): Promise<DbRegister | null> {
    return this.shifts.findRegisterById(id, businessId);
  }
  updateRegister(id: string, businessId: string, patch: Partial<Omit<DbRegister, "id" | "businessId">>): Promise<DbRegister | null> {
    return this.shifts.updateRegister(id, businessId, patch);
  }
  createShift(s: Omit<DbShift, "id">): Promise<DbShift> {
    return this.shifts.createShift(s);
  }
  findShiftById(id: string, businessId: string): Promise<DbShift | null> {
    return this.shifts.findShiftById(id, businessId);
  }
  findOpenShiftByRegister(businessId: string, registerId: string): Promise<DbShift | null> {
    return this.shifts.findOpenShiftByRegister(businessId, registerId);
  }
  listShiftsByBusiness(businessId: string): Promise<DbShift[]> {
    return this.shifts.listShiftsByBusiness(businessId);
  }
  updateShift(id: string, businessId: string, patch: Partial<Omit<DbShift, "id" | "businessId">>): Promise<DbShift | null> {
    return this.shifts.updateShift(id, businessId, patch);
  }
  createCashMovement(m: Omit<DbCashMovement, "id">): Promise<DbCashMovement> {
    return this.shifts.createCashMovement(m);
  }
  listCashMovementsByShift(shiftId: string, businessId: string): Promise<DbCashMovement[]> {
    return this.shifts.listCashMovementsByShift(shiftId, businessId);
  }
  hasShiftForRegister(businessId: string, registerId: string): Promise<boolean> {
    return this.shifts.hasShiftForRegister(businessId, registerId);
  }
}

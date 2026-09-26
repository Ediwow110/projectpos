import type { AuditEntry, DbApiToken, DbBalance, DbBranch, DbBusiness, DbCashMovement, DbCategory, DbCustomer, DbDevice, DbExpense, DbFeatureFlag, DbHeldSale, DbIdempotency, DbInvoice, DbMovement, DbPayment, DbPlan, DbMembership, DbPort, DbPrinter, DbPrintJob, DbProduct, DbRefund, DbRefundItem, DbRegister, DbResetToken, DbSale, DbSaleItem, DbSession, DbShift, DbShiftCorrection, DbStockTransfer, DbStockTransferLine, DbSubscription, DbDisplayToken, DbUsageCounter, DbUser, DbWebhookEvent } from "../db.port";
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
import { devicesFamily } from "./pg-devices";
import { billingFamily } from "./pg-billing";
import { integrationsFamily } from "./pg-integrations";

// Phase 12: the PostgreSQL-backed DbPort. Composed from per-family modules
// over one PgContext; `implements DbPort` makes the compiler enforce that the
// full interface is covered.
export class PgDbPort implements DbPort {
  private readonly settings: ReturnType<typeof settingsFamily>;
  private readonly audit: ReturnType<typeof auditFamily>;
  private readonly tenants: ReturnType<typeof tenantsFamily>;
  private readonly catalog: ReturnType<typeof catalogFamily>;
  private readonly inventory: ReturnType<typeof inventoryFamily>;
  private readonly sales: ReturnType<typeof salesFamily>;
  private readonly shifts: ReturnType<typeof shiftsFamily>;
  private readonly people: ReturnType<typeof peopleFamily>;
  private readonly branches: ReturnType<typeof branchesFamily>;
  private readonly devices: ReturnType<typeof devicesFamily>;
  private readonly billing: ReturnType<typeof billingFamily>;
  private readonly integrations: ReturnType<typeof integrationsFamily>;

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
    this.devices = devicesFamily(ctx);
    this.billing = billingFamily(ctx);
    this.integrations = integrationsFamily(ctx);
  }

  // withLock/withTransaction come straight from the context so every family
  // shares the transaction scope.
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.ctx.withLock(key, fn);
  }
  withTransaction<T>(fn: (db: DbPort) => Promise<T>): Promise<T> {
    return this.ctx.withTransaction(() => fn(this));
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
  updateSession(id: string, patch: { activeBusinessId?: string | null; authenticatedAt?: Date }): Promise<void> {
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

  // Catalog family.
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
  // Inventory family.
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
  // Devices family.
  createDevice(d: Omit<DbDevice, "id">): Promise<DbDevice> {
    return this.devices.createDevice(d);
  }
  listDevicesByBusiness(businessId: string): Promise<DbDevice[]> {
    return this.devices.listDevicesByBusiness(businessId);
  }
  findDeviceById(id: string, businessId: string): Promise<DbDevice | null> {
    return this.devices.findDeviceById(id, businessId);
  }
  revokeDevice(id: string, businessId: string, revokedAt: Date): Promise<DbDevice | null> {
    return this.devices.revokeDevice(id, businessId, revokedAt);
  }
  revokeSessionsByDevice(businessId: string, deviceId: string): Promise<void> {
    return this.devices.revokeSessionsByDevice(businessId, deviceId);
  }
  // Billing family.
  listPlans(): Promise<DbPlan[]> {
    return this.billing.listPlans();
  }
  findPlanByKey(key: string): Promise<DbPlan | null> {
    return this.billing.findPlanByKey(key);
  }
  getSubscription(businessId: string): Promise<DbSubscription | null> {
    return this.billing.getSubscription(businessId);
  }
  upsertSubscription(s: Omit<DbSubscription, "id" | "providerRef"> & { providerRef?: string | null }): Promise<DbSubscription> {
    return this.billing.upsertSubscription(s);
  }
  updateSubscription(id: string, businessId: string, patch: Partial<Omit<DbSubscription, "id" | "businessId">>): Promise<DbSubscription | null> {
    return this.billing.updateSubscription(id, businessId, patch);
  }
  listInvoices(businessId: string): Promise<DbInvoice[]> {
    return this.billing.listInvoices(businessId);
  }
  createInvoice(i: Omit<DbInvoice, "id" | "issuedAt">): Promise<DbInvoice> {
    return this.billing.createInvoice(i);
  }
  updateInvoice(id: string, businessId: string, patch: Partial<Omit<DbInvoice, "id" | "businessId">>): Promise<DbInvoice | null> {
    return this.billing.updateInvoice(id, businessId, patch);
  }
  listCounters(businessId: string): Promise<DbUsageCounter[]> {
    return this.billing.listCounters(businessId);
  }
  setCounter(businessId: string, key: string, period: string, count: number): Promise<DbUsageCounter> {
    return this.billing.setCounter(businessId, key, period, count);
  }
  getFlag(businessId: string | null, key: string): Promise<DbFeatureFlag | null> {
    return this.billing.getFlag(businessId, key);
  }
  setFlag(f: { businessId: string | null; key: string; enabled: boolean }): Promise<DbFeatureFlag> {
    return this.billing.setFlag(f);
  }
  findWebhookEvent(provider: string, eventId: string): Promise<DbWebhookEvent | null> {
    return this.billing.findWebhookEvent(provider, eventId);
  }
  createWebhookEvent(e: Omit<DbWebhookEvent, "id" | "receivedAt">): Promise<DbWebhookEvent> {
    return this.billing.createWebhookEvent(e);
  }
  claimWebhookEvent(e: Omit<DbWebhookEvent, "id" | "receivedAt">): Promise<DbWebhookEvent | null> {
    return this.billing.claimWebhookEvent(e);
  }
  updateWebhookEventStatus(id: string, status: string): Promise<void> {
    return this.billing.updateWebhookEventStatus(id, status);
  }
  updateWebhookEventReceivedAt(id: string, receivedAt: Date): Promise<void> {
    return this.billing.updateWebhookEventReceivedAt(id, receivedAt);
  }
  deleteWebhookEvent(id: string): Promise<void> {
    return this.billing.deleteWebhookEvent(id);
  }
  // Integrations family.
  createApiToken(t: Omit<DbApiToken, "id">): Promise<DbApiToken> {
    return this.integrations.createApiToken(t);
  }
  listApiTokens(businessId: string): Promise<DbApiToken[]> {
    return this.integrations.listApiTokens(businessId);
  }
  findApiTokenByPrefix(prefix: string): Promise<DbApiToken | null> {
    return this.integrations.findApiTokenByPrefix(prefix);
  }
  listApiTokensByPrefix(prefix: string): Promise<DbApiToken[]> {
    return this.integrations.listApiTokensByPrefix(prefix);
  }
  revokeApiToken(id: string, businessId: string, revokedAt: Date): Promise<DbApiToken | null> {
    return this.integrations.revokeApiToken(id, businessId, revokedAt);
  }
  createPrinter(p: Omit<DbPrinter, "id">): Promise<DbPrinter> {
    return this.integrations.createPrinter(p);
  }
  listPrinters(businessId: string): Promise<DbPrinter[]> {
    return this.integrations.listPrinters(businessId);
  }
  findPrinterById(id: string, businessId: string): Promise<DbPrinter | null> {
    return this.integrations.findPrinterById(id, businessId);
  }
  findPrinterByAgentTokenHash(tokenHash: string): Promise<DbPrinter | null> {
    return this.integrations.findPrinterByAgentTokenHash(tokenHash);
  }
  createPrintJob(j: Omit<DbPrintJob, "id">): Promise<DbPrintJob> {
    return this.integrations.createPrintJob(j);
  }
  listPrintJobs(businessId: string, status?: string): Promise<DbPrintJob[]> {
    return this.integrations.listPrintJobs(businessId, status);
  }
  updatePrintJob(id: string, businessId: string, patch: Partial<Omit<DbPrintJob, "id" | "businessId">>, expectedStatus?: string): Promise<DbPrintJob | null> {
    return this.integrations.updatePrintJob(id, businessId, patch, expectedStatus);
  }
  createDisplayToken(t: Omit<DbDisplayToken, "id">): Promise<DbDisplayToken> {
    return this.integrations.createDisplayToken(t);
  }
  findDisplayToken(tokenHash: string): Promise<DbDisplayToken | null> {
    return this.integrations.findDisplayToken(tokenHash);
  }
  createSupportGrant(g: { purpose: string; actorId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }> {
    return this.integrations.createSupportGrant(g);
  }
  findValidSupportGrant(tokenHash: string): Promise<{ id: string; purpose: string; actorId: string; expiresAt: Date } | null> {
    return this.integrations.findValidSupportGrant(tokenHash);
  }
  markSupportGrantUsed(id: string): Promise<void> {
    return this.integrations.markSupportGrantUsed(id);
  }
  createShiftCorrection(c: { businessId: string; shiftId: string; amountMinor: number; reason: string; actorId: string; requestId: string }): Promise<DbShiftCorrection> {
    return this.integrations.createShiftCorrection(c);
  }
  listShiftCorrections(businessId: string, shiftId: string): Promise<DbShiftCorrection[]> {
    return this.integrations.listShiftCorrections(businessId, shiftId);
  }
  createReceiptShare(s: { businessId: string; saleId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }> {
    return this.integrations.createReceiptShare(s);
  }
  findValidReceiptShare(tokenHash: string): Promise<{ id: string; businessId: string; saleId: string; expiresAt: Date } | null> {
    return this.integrations.findValidReceiptShare(tokenHash);
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
  listRefundsByBusiness(businessId: string): Promise<DbRefund[]> {
    return this.people.listRefundsByBusiness(businessId);
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
  listRefundItemsByBusiness(businessId: string): Promise<DbRefundItem[]> {
    return this.people.listRefundItemsByBusiness(businessId);
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
  listSaleItemsByBusiness(businessId: string): Promise<DbSaleItem[]> {
    return this.sales.listSaleItemsByBusiness(businessId);
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
  nextReceiptNo(businessId: string): Promise<string> {
    return this.sales.nextReceiptNo(businessId);
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

export interface DbUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

export interface DbBusiness {
  id: string;
  name: string;
  currency: string;
}

export interface DbMembership {
  id: string;
  businessId: string;
  userId: string;
  role: string;
}

export interface DbPlan {
  id: string;
  key: string;
  name: string;
  allowances: { users: number | null; products: number | null; registers: number | null; branches: number | null; features: string[] };
  pricesMinor: { monthlyMinor: number };
  isActive: boolean;
}

export interface DbSubscription {
  id: string;
  businessId: string;
  planId: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
  providerRef: string | null;
}

export interface DbInvoice {
  id: string;
  businessId: string;
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  amountMinor: number;
  currency: string;
  status: string;
  issuedAt: Date;
  paidAt: Date | null;
}

export interface DbUsageCounter {
  id: string;
  businessId: string;
  key: string;
  period: string;
  count: number;
}

export interface DbFeatureFlag {
  id: string;
  businessId: string | null;
  key: string;
  enabled: boolean;
}

export interface DbWebhookEvent {
  id: string;
  businessId: string | null;
  provider: string;
  eventId: string;
  type: string;
  payload: unknown;
  status: string;
}

export interface DbApiToken {
  id: string;
  businessId: string;
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: string[];
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export interface DbPrinter {
  id: string;
  businessId: string;
  branchId: string | null;
  name: string;
  width: string;
  connection: string;
  // Hash of the paired-agent token; null for printers enrolled before agent
  // tokens existed (they simply cannot poll until re-enrolled).
  agentTokenHash: string | null;
}

export interface DbPrintJob {
  id: string;
  businessId: string;
  printerId: string;
  receiptNo: string | null;
  layout: string;
  status: string;
  payload: string;
  attempts: number;
  createdAt: Date;
}

export interface DbDisplayToken {
  id: string;
  businessId: string;
  registerId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface DbSession {
  id: string;
  userId: string;
  businessId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  authenticatedAt: Date;
  ip: string | null;
  userAgent: string | null;
  // Phase 9b: bound POS device; null/undefined = pre-9b sessions and non-device logins.
  deviceId?: string | null;
}

export interface DbResetToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  requestId: string;
  ip: string | null;
}

export interface AuditEntry {
  businessId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
}

export interface DbCategory {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface DbProduct {
  id: string;
  businessId: string;
  categoryId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  unit: string;
  costMinor: number;
  priceMinor: number;
  taxRateBps: number | null;
  reorderLevel: number;
  trackInventory: boolean;
  isActive: boolean;
  imageUrl: string | null;
}


export interface DbMovement {
  id: string;
  businessId: string;
  productId: string;
  type: string;
  qtyDelta: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string;
  requestId: string;
  // Phase 9a: nullable branch scope; undefined = legacy rows.
  branchId?: string | null;
}

export interface DbBalance {
  id: string;
  businessId: string;
  productId: string;
  qtyOnHand: number;
  // Phase 9a: nullable branch scope; null/undefined = legacy head-office scope.
  branchId?: string | null;
}

export interface DbSale {
  id: string;
  businessId: string;
  receiptNo: string;
  status: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  currency: string;
  customerId: string | null;
  customerName: string | null;
  notes: string | null;
  actorId: string;
  requestId: string;
  idempotencyKey: string | null;
  registerId: string | null;
  // Phase 9a: register's branch, else explicit input, else null.
  branchId?: string | null;
  createdAt: Date;
}

export interface DbSaleItem {
  id: string;
  businessId: string;
  saleId: string;
  productId: string;
  name: string;
  unit: string;
  qty: number;
  priceMinor: number;
  costMinor: number;
  taxRateBps: number | null;
  lineDiscountMinor: number;
  lineTotalMinor: number;
}

export interface DbPayment {
  id: string;
  businessId: string;
  saleId: string;
  method: string;
  amountMinor: number;
  status: string;
  providerRef: string | null;
  idempotencyKey: string;
}

export interface DbHeldSale {
  id: string;
  businessId: string;
  actorId: string;
  payload: unknown;
  resumedAt: Date | null;
}

export interface DbIdempotency {
  businessId: string;
  key: string;
  commandType: string;
  fingerprint: string;
  resultId: string;
}

export interface DbRegister {
  id: string;
  businessId: string;
  name: string;
  isActive: boolean;
  // Phase 9a: optional home branch.
  branchId?: string | null;
}

export interface DbShift {
  id: string;
  businessId: string;
  registerId: string;
  // Phase 9a: copied from register at open.
  branchId?: string | null;
  status: string;
  openedBy: string;
  closedBy: string | null;
  openingFloatMinor: number;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  cashSalesMinor: number;
  cashRefundsMinor: number;
  cashExpensesMinor: number;
  cashDepositsMinor: number;
  cashWithdrawalsMinor: number;
  adjustmentsMinor: number;
  expectedCashMinor: number;
  closeNotes: string | null;
}

export interface DbCashMovement {
  id: string;
  businessId: string;
  shiftId: string;
  registerId: string;
  // Phase 9a: copied from shift.
  branchId?: string | null;
  type: string;
  amountMinor: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string;
  requestId: string;
}

export interface DbCustomer {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface DbRefund {
  id: string;
  businessId: string;
  saleId: string;
  status: string;
  totalMinor: number;
  reason: string | null;
  requestedBy: string;
  approvedBy: string;
  requestId: string;
  approvedRequestId: string;
  singleStep: boolean;
}

export interface DbRefundItem {
  id: string;
  businessId: string;
  refundId: string;
  saleItemId: string;
  productId: string;
  qty: number;
  amountMinor: number;
  restocked: boolean;
}

export interface DbExpense {
  id: string;
  businessId: string;
  category: string;
  amountMinor: number;
  description: string | null;
  method: string;
  shiftId: string | null;
  // Phase 9a: shift's branch when shift-linked, else explicit input, else null.
  branchId?: string | null;
  expenseDate: Date;
  actorId: string;
  requestId: string;
  attachmentUrl: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  cashAdjusted: boolean;
}

export interface DbBranch {
  id: string;
  businessId: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface DbStockTransfer {
  id: string;
  businessId: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  requestedBy: string;
  dispatchedBy: string | null;
  receivedBy: string | null;
  requestId: string;
}

export interface DbStockTransferLine {
  id: string;
  businessId: string;
  transferId: string;
  productId: string;
  qty: number;
}

export interface DbDevice {
  id: string;
  businessId: string;
  userId: string;
  label: string;
  revokedAt: Date | null;
}

export interface DbPort {
  findUserByEmail(email: string): Promise<DbUser | null>;
  findUserById(id: string): Promise<DbUser | null>;
  createUser(u: Omit<DbUser, "id">): Promise<DbUser>;
  updateUserPassword(id: string, passwordHash: string): Promise<void>;
  createBusiness(b: Omit<DbBusiness, "id">): Promise<DbBusiness>;
  findBusinessById(id: string): Promise<DbBusiness | null>;
  listMembershipsByUser(userId: string): Promise<DbMembership[]>;
  findMembership(userId: string, businessId: string): Promise<DbMembership | null>;
  createMembership(m: Omit<DbMembership, "id">): Promise<DbMembership>;
  createSession(s: Omit<DbSession, "id">): Promise<DbSession>;
  findSessionByTokenHash(tokenHash: string): Promise<DbSession | null>;
  listSessionsByUser(userId: string): Promise<DbSession[]>;
  revokeSession(id: string): Promise<void>;
  revokeAllUserSessions(userId: string, exceptId?: string): Promise<void>;
  saveResetToken(t: DbResetToken): Promise<void>;
  findResetToken(tokenHash: string): Promise<DbResetToken | null>;
  markResetTokenUsed(tokenHash: string, usedAt: Date): Promise<void>;
  getSettings(businessId: string): Promise<Record<string, unknown>>;
  saveSettings(businessId: string, settings: Record<string, unknown>): Promise<void>;
  appendAudit(e: AuditEntry): Promise<void>;
  listAudit(): Promise<AuditEntry[]>;
  createCategory(c: Omit<DbCategory, "id">): Promise<DbCategory>;
  listCategories(businessId: string): Promise<DbCategory[]>;
  findCategoryById(id: string, businessId: string): Promise<DbCategory | null>;
  updateCategory(id: string, businessId: string, patch: Partial<Omit<DbCategory, "id" | "businessId">>): Promise<DbCategory | null>;
  createProduct(p: Omit<DbProduct, "id">): Promise<DbProduct>;
  listProducts(businessId: string): Promise<DbProduct[]>;
  findProductById(id: string, businessId: string): Promise<DbProduct | null>;
  updateProduct(id: string, businessId: string, patch: Partial<Omit<DbProduct, "id" | "businessId">>): Promise<DbProduct | null>;
  createMovement(m: Omit<DbMovement, "id">): Promise<DbMovement>;
  listMovements(productId: string, businessId: string, branchId?: string | null): Promise<DbMovement[]>;
  listMovementsByBusiness(businessId: string): Promise<DbMovement[]>;
  listMovementsPage(businessId: string, afterId: string | null, limit: number): Promise<DbMovement[]>;
  upsertBalance(b: Omit<DbBalance, "id">): Promise<DbBalance>;
  findBalance(productId: string, businessId: string, branchId?: string | null): Promise<DbBalance | null>;
  listBalances(businessId: string): Promise<DbBalance[]>;
  createSale(s: Omit<DbSale, "id">): Promise<DbSale>;
  findSaleById(id: string, businessId: string): Promise<DbSale | null>;
  listSalesByBusiness(businessId: string): Promise<DbSale[]>;
  listSalesPage(businessId: string, afterId: string | null, limit: number): Promise<DbSale[]>;
  updateSale(id: string, businessId: string, patch: Partial<Omit<DbSale, "id" | "businessId">>): Promise<DbSale | null>;
  createSaleItem(i: Omit<DbSaleItem, "id">): Promise<DbSaleItem>;
  listSaleItems(saleId: string, businessId: string): Promise<DbSaleItem[]>;
  createPayment(p: Omit<DbPayment, "id">): Promise<DbPayment>;
  findPaymentById(id: string, businessId: string): Promise<DbPayment | null>;
  listPaymentsBySale(saleId: string, businessId: string): Promise<DbPayment[]>;
  updatePayment(id: string, businessId: string, patch: Partial<Omit<DbPayment, "id" | "businessId">>): Promise<DbPayment | null>;
  createHeldSale(h: Omit<DbHeldSale, "id">): Promise<DbHeldSale>;
  findHeldSaleById(id: string, businessId: string): Promise<DbHeldSale | null>;
  listHeldSales(businessId: string, actorId: string): Promise<DbHeldSale[]>;
  markHeldResumed(id: string, businessId: string): Promise<void>;
  claimIdempotency(r: DbIdempotency): Promise<void>;
  findIdempotency(businessId: string, key: string, commandType: string): Promise<DbIdempotency | null>;
  nextReceiptNo(businessId: string): Promise<string>;
  createRegister(r: Omit<DbRegister, "id">): Promise<DbRegister>;
  listRegisters(businessId: string): Promise<DbRegister[]>;
  findRegisterById(id: string, businessId: string): Promise<DbRegister | null>;
  updateRegister(id: string, businessId: string, patch: Partial<Omit<DbRegister, "id" | "businessId">>): Promise<DbRegister | null>;
  createShift(s: Omit<DbShift, "id">): Promise<DbShift>;
  findShiftById(id: string, businessId: string): Promise<DbShift | null>;
  findOpenShiftByRegister(businessId: string, registerId: string): Promise<DbShift | null>;
  listShiftsByBusiness(businessId: string): Promise<DbShift[]>;
  updateShift(id: string, businessId: string, patch: Partial<Omit<DbShift, "id" | "businessId">>): Promise<DbShift | null>;
  createCashMovement(m: Omit<DbCashMovement, "id">): Promise<DbCashMovement>;
  listCashMovementsByShift(shiftId: string, businessId: string): Promise<DbCashMovement[]>;
  createCustomer(c: Omit<DbCustomer, "id">): Promise<DbCustomer>;
  listCustomersByBusiness(businessId: string): Promise<DbCustomer[]>;
  findCustomerById(id: string, businessId: string): Promise<DbCustomer | null>;
  updateCustomer(id: string, businessId: string, patch: Partial<Omit<DbCustomer, "id" | "businessId">>): Promise<DbCustomer | null>;
  createRefund(r: Omit<DbRefund, "id">): Promise<DbRefund>;
  listRefundsBySale(saleId: string, businessId: string): Promise<DbRefund[]>;
  findRefundById(id: string, businessId: string): Promise<DbRefund | null>;
  createRefundItem(i: Omit<DbRefundItem, "id">): Promise<DbRefundItem>;
  listRefundItems(refundId: string, businessId: string): Promise<DbRefundItem[]>;
  listRefundItemsBySale(saleId: string, businessId: string): Promise<DbRefundItem[]>;
  createExpense(e: Omit<DbExpense, "id">): Promise<DbExpense>;
  listExpensesByBusiness(businessId: string): Promise<DbExpense[]>;
  listExpensesPage(businessId: string, afterId: string | null, limit: number): Promise<DbExpense[]>;
  findExpenseById(id: string, businessId: string): Promise<DbExpense | null>;
  updateExpense(id: string, businessId: string, patch: Partial<Omit<DbExpense, "id" | "businessId">>): Promise<DbExpense | null>;
  createBranch(b: Omit<DbBranch, "id">): Promise<DbBranch>;
  listBranchesByBusiness(businessId: string): Promise<DbBranch[]>;
  findBranchById(id: string, businessId: string): Promise<DbBranch | null>;
  updateBranch(id: string, businessId: string, patch: Partial<Omit<DbBranch, "id" | "businessId">>): Promise<DbBranch | null>;
  createTransfer(t: Omit<DbStockTransfer, "id">): Promise<DbStockTransfer>;
  findTransferById(id: string, businessId: string): Promise<DbStockTransfer | null>;
  listTransfersByBusiness(businessId: string): Promise<DbStockTransfer[]>;
  updateTransfer(id: string, businessId: string, patch: Partial<Omit<DbStockTransfer, "id" | "businessId">>): Promise<DbStockTransfer | null>;
  createTransferLine(l: Omit<DbStockTransferLine, "id">): Promise<DbStockTransferLine>;
  listTransferLines(transferId: string, businessId: string): Promise<DbStockTransferLine[]>;
  createDevice(d: Omit<DbDevice, "id">): Promise<DbDevice>;
  listDevicesByBusiness(businessId: string): Promise<DbDevice[]>;
  findDeviceById(id: string, businessId: string): Promise<DbDevice | null>;
  revokeDevice(id: string, businessId: string, revokedAt: Date): Promise<DbDevice | null>;
  revokeSessionsByDevice(businessId: string, deviceId: string): Promise<void>;
  listMembershipsByBusiness(businessId: string): Promise<DbMembership[]>;
  listPlans(): Promise<DbPlan[]>;
  findPlanByKey(key: string): Promise<DbPlan | null>;
  getSubscription(businessId: string): Promise<DbSubscription | null>;
  upsertSubscription(s: Omit<DbSubscription, "id" | "providerRef"> & { providerRef?: string | null }): Promise<DbSubscription>;
  updateSubscription(id: string, businessId: string, patch: Partial<Omit<DbSubscription, "id" | "businessId">>): Promise<DbSubscription | null>;
  listInvoices(businessId: string): Promise<DbInvoice[]>;
  createInvoice(i: Omit<DbInvoice, "id" | "issuedAt">): Promise<DbInvoice>;
  updateInvoice(id: string, businessId: string, patch: Partial<Omit<DbInvoice, "id" | "businessId">>): Promise<DbInvoice | null>;
  listCounters(businessId: string): Promise<DbUsageCounter[]>;
  setCounter(businessId: string, key: string, period: string, count: number): Promise<DbUsageCounter>;
  getFlag(businessId: string | null, key: string): Promise<DbFeatureFlag | null>;
  setFlag(f: { businessId: string | null; key: string; enabled: boolean }): Promise<DbFeatureFlag>;
  findWebhookEvent(provider: string, eventId: string): Promise<DbWebhookEvent | null>;
  createWebhookEvent(e: Omit<DbWebhookEvent, "id" | "receivedAt">): Promise<DbWebhookEvent>;
  // Atomic claim: the first caller for an eventId wins and gets true, every
  // concurrent redelivery gets false. Backed by the unique index on eventId.
  claimWebhookEvent(e: Omit<DbWebhookEvent, "id" | "receivedAt">): Promise<DbWebhookEvent | null>;
  updateWebhookEventStatus(id: string, status: string): Promise<void>;
  deleteWebhookEvent(id: string): Promise<void>;
  createApiToken(t: Omit<DbApiToken, "id">): Promise<DbApiToken>;
  listApiTokens(businessId: string): Promise<DbApiToken[]>;
  findApiTokenByPrefix(prefix: string): Promise<DbApiToken | null>;
  revokeApiToken(id: string, businessId: string, revokedAt: Date): Promise<DbApiToken | null>;
  createPrinter(p: Omit<DbPrinter, "id">): Promise<DbPrinter>;
  listPrinters(businessId: string): Promise<DbPrinter[]>;
  findPrinterById(id: string, businessId: string): Promise<DbPrinter | null>;
  findPrinterByAgentTokenHash(tokenHash: string): Promise<DbPrinter | null>;
  createPrintJob(j: Omit<DbPrintJob, "id">): Promise<DbPrintJob>;
  listPrintJobs(businessId: string, status?: string): Promise<DbPrintJob[]>;
  updatePrintJob(id: string, businessId: string, patch: Partial<Omit<DbPrintJob, "id" | "businessId">>, expectedStatus?: string): Promise<DbPrintJob | null>;
  createDisplayToken(t: Omit<DbDisplayToken, "id">): Promise<DbDisplayToken>;
  findDisplayToken(tokenHash: string): Promise<DbDisplayToken | null>;
}

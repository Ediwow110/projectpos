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
}

export interface DbBalance {
  id: string;
  businessId: string;
  productId: string;
  qtyOnHand: number;
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
}

export interface DbShift {
  id: string;
  businessId: string;
  registerId: string;
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
  expenseDate: Date;
  actorId: string;
  requestId: string;
  attachmentUrl: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  cashAdjusted: boolean;
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
  listMovements(productId: string, businessId: string): Promise<DbMovement[]>;
  listMovementsByBusiness(businessId: string): Promise<DbMovement[]>;
  upsertBalance(b: Omit<DbBalance, "id">): Promise<DbBalance>;
  findBalance(productId: string, businessId: string): Promise<DbBalance | null>;
  listBalances(businessId: string): Promise<DbBalance[]>;
  createSale(s: Omit<DbSale, "id">): Promise<DbSale>;
  findSaleById(id: string, businessId: string): Promise<DbSale | null>;
  listSalesByBusiness(businessId: string): Promise<DbSale[]>;
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
  findExpenseById(id: string, businessId: string): Promise<DbExpense | null>;
  updateExpense(id: string, businessId: string, patch: Partial<Omit<DbExpense, "id" | "businessId">>): Promise<DbExpense | null>;
}

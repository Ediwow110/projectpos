export interface DbUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  // Phase 11: undefined/true = verified (legacy rows, invited members);
  // false only when the business opts into email verification.
  emailVerified?: boolean;
  // Per-user first-run workspace guidance. False/undefined means the shared
  // AppShell may auto-show the tour after required business onboarding.
  workspaceTourSeen?: boolean;
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
  // Phase 11: set when the member is deactivated; deactivated members have no access.
  deactivatedAt?: Date | null;
  // Business-scoped staff approval PIN. Only the Argon2id hash is persisted.
  approvalPinHash?: string | null;
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
  // When the claim was taken; a "processing" row older than the claim TTL is
  // treated as crashed and taken over by a redelivery.
  receivedAt: Date;
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
  lastSeenAt?: Date | null;
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

export interface DbReceiptDelivery {
  id: string;
  businessId: string;
  saleId: string;
  channel: "email";
  recipient: string;
  status: "PENDING" | "SENT" | "FAILED";
  idempotencyKey: string;
  errorCode: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface DbDisplayToken {
  id: string;
  businessId: string;
  registerId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface DbManagerApprovalGrant {
  id: string;
  businessId: string;
  requesterId: string;
  approverId: string;
  permission: string;
  fingerprint: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface DbSession {
  id: string;
  userId: string;
  businessId: string;
  // Phase 11: explicit active business chosen via POST /auth/active-business;
  // null/undefined = home business from login.
  activeBusinessId?: string | null;
  // Workspace branch scope; null/undefined means "All branches".
  activeBranchId?: string | null;
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
  // Null for platform-scoped actions (global feature flags), which belong to
  // no tenant; the database allows it.
  businessId: string | null;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
  // Phase 11 (PLAN 6.7): the store stamps `at` when the caller omits it;
  // reason and before/after snapshots are optional context for sensitive writes.
  at?: Date;
  reason?: string;
  before?: unknown;
  after?: unknown;
}

export interface DbShiftCorrection {
  id: string;
  businessId: string;
  shiftId: string;
  amountMinor: number;
  reason: string;
  actorId: string;
  requestId: string;
  createdAt: Date;
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
  familyId?: string | null;
  productType?: "STANDARD" | "BUNDLE";
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

export interface DbProductFamily {
  id: string;
  businessId: string;
  name: string;
  categoryId: string | null;
  brand: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbProductOption {
  id: string;
  businessId: string;
  familyId: string;
  name: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbProductOptionValue {
  id: string;
  businessId: string;
  optionId: string;
  value: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbProductVariantOptionValue {
  id: string;
  businessId: string;
  productId: string;
  optionId: string;
  optionValueId: string;
  createdAt: Date;
}

export interface DbProductBundle {
  id: string;
  businessId: string;
  bundleProductId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbBundleComponent {
  id: string;
  businessId: string;
  bundleId: string;
  componentProductId: string;
  quantity: number;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbSaleItemBundleComponent {
  id: string;
  businessId: string;
  saleItemId: string;
  bundleId: string;
  componentProductId: string;
  componentNameSnapshot: string;
  quantityPerBundleSnapshot: number;
  costMinorSnapshot: number;
  compositionVersion: number;
  createdAt: Date;
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
  updatedAt?: Date;
  // Phase 9a: nullable branch scope; null/undefined = legacy head-office scope.
  branchId?: string | null;
}

export type InventoryCountStatus = "DRAFT" | "COUNTING" | "SUBMITTED" | "APPROVED" | "POSTED" | "CANCELLED";
export type InventoryCountScope = "FULL" | "PARTIAL";

export interface DbInventoryCount {
  id: string;
  businessId: string;
  branchId: string | null;
  countNumber: string;
  status: InventoryCountStatus;
  scopeType: InventoryCountScope;
  name: string;
  notes: string | null;
  createdBy: string;
  startedAt: Date | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  approvalFingerprint: string | null;
  postedBy: string | null;
  postedAt: Date | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbInventoryCountLine {
  id: string;
  businessId: string;
  inventoryCountId: string;
  productId: string;
  expectedQtySnapshot: number;
  balanceUpdatedAtSnapshot: Date | null;
  countedQty: number | null;
  varianceQty: number | null;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  notes: string | null;
  countedBy: string | null;
  countedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  // Set when the sale reaches COMPLETED; usage metering buckets by this, not by
  // when the draft was created.
  completedAt?: Date | null;
}

export interface DbSaleItem {
  id: string;
  businessId: string;
  saleId: string;
  position: number;
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
  internalInstrumentType?: "gift_card" | "store_credit" | "loyalty" | null;
  internalInstrumentId?: string | null;
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

export type GiftCardStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXHAUSTED" | "VOID";

export interface DbGiftCard {
  id: string;
  businessId: string;
  codeHash: string;
  codePrefix: string;
  codeLast4: string;
  status: GiftCardStatus;
  createdBy: string;
  activatedAt: Date | null;
  suspendedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbGiftCardTransaction {
  id: string;
  businessId: string;
  giftCardId: string;
  type: string;
  amountDeltaMinor: number;
  saleId: string | null;
  refundId: string | null;
  loadId?: string | null;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  reason: string | null;
  branchId: string | null;
  createdAt: Date;
}

export interface DbStoreCreditAccount {
  id: string;
  businessId: string;
  customerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbStoreCreditTransaction {
  id: string;
  businessId: string;
  accountId: string;
  customerId: string;
  type: string;
  amountDeltaMinor: number;
  saleId: string | null;
  refundId: string | null;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  reason: string | null;
  branchId: string | null;
  createdAt: Date;
}

export interface DbLoyaltyProgram {
  id: string;
  businessId: string;
  enabled: boolean;
  earnAmountMinor: number;
  earnPoints: number;
  redeemPoints: number;
  redeemValueMinor: number;
  minimumRedeemPoints: number | null;
  version: number;
  updatedAt: Date;
}

export interface DbLoyaltyAccount {
  id: string;
  businessId: string;
  customerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbLoyaltyTransaction {
  id: string;
  businessId: string;
  accountId: string;
  customerId: string;
  type: string;
  pointsDelta: number;
  valueMinorSnapshot: number | null;
  saleId: string | null;
  refundId: string | null;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  reason: string | null;
  createdAt: Date;
}

export interface DbSaleGiftCardLoad {
  id: string;
  businessId: string;
  saleId: string;
  giftCardId: string | null;
  amountMinor: number;
  kind: "NEW" | "RELOAD";
  createdAt: Date;
}

export interface DbSaleLoyalty {
  id: string;
  businessId: string;
  saleId: string;
  customerId: string;
  loyaltyAccountId: string;
  programVersion: number;
  eligibleSpendMinor: number;
  earnedPoints: number;
  redeemedPoints: number;
  redeemedValueMinor: number;
  earnAmountMinorSnapshot: number;
  earnPointsSnapshot: number;
  redeemPointsSnapshot: number;
  redeemValueMinorSnapshot: number;
  createdAt: Date;
}

export interface DbSaleItemLoyaltyAllocation {
  id: string;
  businessId: string;
  saleLoyaltyId: string;
  saleItemId: string;
  earnedPoints: number;
  createdAt: Date;
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

export interface DbExchange {
  id: string;
  businessId: string;
  originalSaleId: string;
  refundId: string;
  replacementSaleId: string;
  returnMinor: number;
  replacementMinor: number;
  netMinor: number;
  direction: "COLLECT" | "REFUND" | "EVEN";
  reason: string;
  actorId: string;
  requestId: string;
  createdAt: Date;
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

// Phase 16: procurement foundation. Supplier/ProductSupplier/PurchaseOrder
// are commercial records only — nothing in this family touches inventory.
export interface DbSupplier {
  id: string;
  businessId: string;
  name: string;
  code: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  paymentTerms: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbProductSupplier {
  id: string;
  businessId: string;
  productId: string;
  supplierId: string;
  supplierSku: string | null;
  unitCostMinor: number | null;
  leadTimeDays: number | null;
  isPreferred: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbPurchaseOrder {
  id: string;
  businessId: string;
  supplierId: string;
  // null = head-office/all-branch scope (existing three-mode branch design).
  branchId: string | null;
  poNumber: string;
  status: string;
  expectedDate: Date | null;
  notes: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  version: number;
  createdBy: string;
  orderedBy: string | null;
  orderedAt: Date | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbPurchaseOrderLine {
  id: string;
  businessId: string;
  purchaseOrderId: string;
  productId: string;
  position: number;
  supplierSkuSnapshot: string | null;
  productNameSnapshot: string;
  quantity: number;
  unitCostMinor: number;
  lineTotalMinor: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbPurchaseReceipt {
  id: string;
  businessId: string;
  purchaseOrderId: string;
  branchId: string | null;
  receiptNumber: string;
  status: string;
  receivedBy: string;
  receivedAt: Date;
  notes: string | null;
  createdAt: Date;
}

export interface DbPurchaseReceiptLine {
  id: string;
  businessId: string;
  purchaseReceiptId: string;
  purchaseOrderLineId: string;
  productId: string;
  quantityReceived: number;
  unitCostMinorSnapshot: number;
  productNameSnapshot: string;
  supplierSkuSnapshot: string | null;
  createdAt: Date;
}

export interface DbSupplierReturn {
  id: string;
  businessId: string;
  supplierId: string;
  purchaseOrderId: string;
  branchId: string | null;
  returnNumber: string;
  status: string;
  reason: string;
  createdBy: string;
  postedBy: string | null;
  postedAt: Date | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbSupplierReturnLine {
  id: string;
  businessId: string;
  supplierReturnId: string;
  purchaseOrderLineId: string;
  productId: string;
  quantity: number;
  unitCostMinorSnapshot: number;
  productNameSnapshot: string;
  supplierSkuSnapshot: string | null;
  createdAt: Date;
  updatedAt: Date;
}

import type {
  AuditEntry,
  DbUser,
  DbBusiness,
  DbMembership,
  DbSession,
  DbResetToken,
  DbCategory,
  DbProduct,
  DbProductFamily,
  DbProductOption,
  DbProductOptionValue,
  DbProductVariantOptionValue,
  DbProductBundle,
  DbBundleComponent,
  DbSaleItemBundleComponent,
  DbMovement,
  DbBalance,
  DbInventoryCount,
  DbInventoryCountLine,
  DbSale,
  DbSaleItem,
  DbPayment,
  DbHeldSale,
  DbIdempotency,
  DbRegister,
  DbShift,
  DbCashMovement,
  DbCustomer,
  DbGiftCard,
  DbGiftCardTransaction,
  DbStoreCreditAccount,
  DbStoreCreditTransaction,
  DbLoyaltyProgram,
  DbLoyaltyAccount,
  DbLoyaltyTransaction,
  DbSaleGiftCardLoad,
  DbSaleLoyalty,
  DbSaleItemLoyaltyAllocation,
  DbRefund,
  DbRefundItem,
  DbExchange,
  DbExpense,
  DbBranch,
  DbStockTransfer,
  DbStockTransferLine,
  DbDevice,
  DbPlan,
  DbSubscription,
  DbInvoice,
  DbUsageCounter,
  DbFeatureFlag,
  DbWebhookEvent,
  DbApiToken,
  DbPrinter,
  DbPrintJob,
  DbDisplayToken,
  DbShiftCorrection,
  DbReceiptDelivery,
  DbSupplier,
  DbProductSupplier,
  DbPurchaseOrder,
  DbPurchaseOrderLine,
  DbPurchaseReceipt,
  DbPurchaseReceiptLine,
  DbSupplierReturn,
  DbSupplierReturnLine,
} from "../db.port";

export type MemoryState = {
  users: Map<string, DbUser>;
  businesses: Map<string, DbBusiness>;
  memberships: Map<string, DbMembership>;
  sessions: Map<string, DbSession>;
  resets: Map<string, DbResetToken>;
  settings: Map<string, Record<string, unknown>>;
  categories: Map<string, DbCategory>;
  products: Map<string, DbProduct>;
  productFamilies: Map<string, DbProductFamily>;
  productOptions: Map<string, DbProductOption>;
  productOptionValues: Map<string, DbProductOptionValue>;
  variantOptionValues: Map<string, DbProductVariantOptionValue>;
  productBundles: Map<string, DbProductBundle>;
  bundleComponents: Map<string, DbBundleComponent>;
  saleItemBundleComponents: Map<string, DbSaleItemBundleComponent>;
  movements: Map<string, DbMovement>;
  balances: Map<string, DbBalance>;
  inventoryCounts: Map<string, DbInventoryCount>;
  inventoryCountLines: Map<string, DbInventoryCountLine>;
  inventoryCountSeq: Map<string, number>;
  sales: Map<string, DbSale>;
  saleItems: Map<string, DbSaleItem>;
  payments: Map<string, DbPayment>;
  heldSales: Map<string, DbHeldSale>;
  idempotency: Map<string, DbIdempotency>;
  purchaseReceiptSeq: Map<string, number>;
  registers: Map<string, DbRegister>;
  shifts: Map<string, DbShift>;
  cashMovements: Map<string, DbCashMovement>;
  customers: Map<string, DbCustomer>;
  giftCards: Map<string, DbGiftCard>;
  giftCardTransactions: Map<string, DbGiftCardTransaction>;
  storeCreditAccounts: Map<string, DbStoreCreditAccount>;
  storeCreditTransactions: Map<string, DbStoreCreditTransaction>;
  loyaltyPrograms: Map<string, DbLoyaltyProgram>;
  loyaltyAccounts: Map<string, DbLoyaltyAccount>;
  loyaltyTransactions: Map<string, DbLoyaltyTransaction>;
  saleGiftCardLoads: Map<string, DbSaleGiftCardLoad>;
  saleLoyalty: Map<string, DbSaleLoyalty>;
  saleItemLoyaltyAllocations: Map<string, DbSaleItemLoyaltyAllocation>;
  refunds: Map<string, DbRefund>;
  refundItems: Map<string, DbRefundItem>;
  exchanges: Map<string, DbExchange>;
  expenses: Map<string, DbExpense>;
  branches: Map<string, DbBranch>;
  transfers: Map<string, DbStockTransfer>;
  transferLines: Map<string, DbStockTransferLine>;
  devices: Map<string, DbDevice>;
  plans: Map<string, DbPlan>;
  subscriptions: Map<string, DbSubscription>;
  invoices: Map<string, DbInvoice>;
  counters: Map<string, DbUsageCounter>;
  flags: Map<string, DbFeatureFlag>;
  webhookEvents: Map<string, DbWebhookEvent>;
  apiTokens: Map<string, DbApiToken>;
  printers: Map<string, DbPrinter>;
  printJobs: Map<string, DbPrintJob>;
  displayTokens: Map<string, DbDisplayToken>;
  emailVerifications: Map<string, { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }>;
  supportGrants: Map<string, { id: string; purpose: string; actorId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }>;
  managerApprovalGrants: Map<string, { id: string; businessId: string; requesterId: string; approverId: string; permission: string; fingerprint: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }>;
  shiftCorrections: Map<string, DbShiftCorrection>;
  receiptShares: Map<string, { id: string; businessId: string; saleId: string; tokenHash: string; expiresAt: Date }>;
  receiptDeliveries: Map<string, DbReceiptDelivery>;
  suppliers: Map<string, DbSupplier>;
  productSuppliers: Map<string, DbProductSupplier>;
  purchaseOrders: Map<string, DbPurchaseOrder>;
  purchaseOrderLines: Map<string, DbPurchaseOrderLine>;
  poSeq: Map<string, number>;
  purchaseReceipts: Map<string, DbPurchaseReceipt>;
  purchaseReceiptLines: Map<string, DbPurchaseReceiptLine>;
  receiptSeq: Map<string, number>;
  supplierReturns: Map<string, DbSupplierReturn>;
  supplierReturnLines: Map<string, DbSupplierReturnLine>;
  supplierReturnSeq: Map<string, number>;
  audit: AuditEntry[];
  nextId: (prefix: string) => string;
  balanceKey: (businessId: string, branchId: string | null | undefined, productId: string) => string;
};

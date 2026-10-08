import type { AuditEntry, DbApiToken, DbBalance, DbBranch, DbBusiness, DbCategory, DbDevice, DbDisplayToken, DbExchange, DbFeatureFlag, DbInvoice, DbMembership, DbMovement, DbPlan, DbPort, DbPrinter, DbPrintJob, DbProduct, DbProductFamily, DbProductOption, DbProductOptionValue, DbProductVariantOptionValue, DbProductBundle, DbBundleComponent, DbSaleItemBundleComponent, DbReceiptDelivery, DbResetToken, DbSession, DbShiftCorrection, DbStockTransfer, DbStockTransferLine, DbSubscription, DbUsageCounter, DbUser, DbSale, DbSaleItem, DbPayment, DbHeldSale, DbIdempotency, DbRegister, DbShift, DbCashMovement, DbCustomer, DbRefund, DbRefundItem, DbExpense, DbWebhookEvent, DbSupplier, DbProductSupplier, DbPurchaseOrder, DbPurchaseOrderLine, DbPurchaseReceipt, DbPurchaseReceiptLine, DbSupplierReturn, DbSupplierReturnLine, DbInventoryCount, DbInventoryCountLine, DbGiftCard, DbGiftCardTransaction, DbStoreCreditAccount, DbStoreCreditTransaction, DbLoyaltyProgram, DbLoyaltyAccount, DbLoyaltyTransaction, DbSaleGiftCardLoad, DbSaleLoyalty, DbSaleItemLoyaltyAllocation } from "./db.port";
import type { MemoryState } from "./memory/context";
import { createMemoryPlatform } from "./memory/platform.family";
import { createMemorySales } from "./memory/sales.family";
import { createMemoryInventory } from "./memory/inventory.family";
import { createMemoryCatalog } from "./memory/catalog.family";
import { createMemoryProcurement } from "./memory/procurement.family";

let n = 0;
const nid = (p: string): string => `${p}_${Date.now().toString(36)}_${(n += 1)}`;

export function createMemoryDb(): DbPort & { audit: AuditEntry[] } {
  const users = new Map<string, DbUser>();
  const businesses = new Map<string, DbBusiness>();
  const memberships = new Map<string, DbMembership>();
  const sessions = new Map<string, DbSession>();
  const resets = new Map<string, DbResetToken>();
  const settings = new Map<string, Record<string, unknown>>();
  const categories = new Map<string, DbCategory>();
  const products = new Map<string, DbProduct>();
  const productFamilies = new Map<string, DbProductFamily>();
  const productOptions = new Map<string, DbProductOption>();
  const productOptionValues = new Map<string, DbProductOptionValue>();
  const variantOptionValues = new Map<string, DbProductVariantOptionValue>();
  const productBundles = new Map<string, DbProductBundle>();
  const bundleComponents = new Map<string, DbBundleComponent>();
  const saleItemBundleComponents = new Map<string, DbSaleItemBundleComponent>();
  const movements = new Map<string, DbMovement>();
  const balances = new Map<string, DbBalance>();
  const inventoryCounts = new Map<string, DbInventoryCount>();
  const inventoryCountLines = new Map<string, DbInventoryCountLine>();
  const inventoryCountSeq = new Map<string, number>();
  const sales = new Map<string, DbSale>();
  const saleItems = new Map<string, DbSaleItem>();
  const payments = new Map<string, DbPayment>();
  const heldSales = new Map<string, DbHeldSale>();
  const idempotency = new Map<string, DbIdempotency>();
  const purchaseReceiptSeq = new Map<string, number>();
  const registers = new Map<string, DbRegister>();
  const shifts = new Map<string, DbShift>();
  const cashMovements = new Map<string, DbCashMovement>();
  const customers = new Map<string, DbCustomer>();
  const giftCards = new Map<string, DbGiftCard>();
  const giftCardTransactions = new Map<string, DbGiftCardTransaction>();
  const storeCreditAccounts = new Map<string, DbStoreCreditAccount>();
  const storeCreditTransactions = new Map<string, DbStoreCreditTransaction>();
  const loyaltyPrograms = new Map<string, DbLoyaltyProgram>();
  const loyaltyAccounts = new Map<string, DbLoyaltyAccount>();
  const loyaltyTransactions = new Map<string, DbLoyaltyTransaction>();
  const saleGiftCardLoads = new Map<string, DbSaleGiftCardLoad>();
  const saleLoyalty = new Map<string, DbSaleLoyalty>();
  const saleItemLoyaltyAllocations = new Map<string, DbSaleItemLoyaltyAllocation>();
  const refunds = new Map<string, DbRefund>();
  const refundItems = new Map<string, DbRefundItem>();
  const exchanges = new Map<string, DbExchange>();
  const expenses = new Map<string, DbExpense>();
  const branches = new Map<string, DbBranch>();
  const transfers = new Map<string, DbStockTransfer>();
  const transferLines = new Map<string, DbStockTransferLine>();
  const devices = new Map<string, DbDevice>();
  const plans = new Map<string, DbPlan>([
    ["plan_free", { id: "plan_free", key: "free", name: "Free", allowances: { users: 3, products: 100, registers: 1, branches: 0, features: [] }, pricesMinor: { monthlyMinor: 0 }, isActive: true }],
    ["plan_basic", { id: "plan_basic", key: "basic", name: "Basic", allowances: { users: 10, products: 2000, registers: 3, branches: 0, features: ["reports", "customers", "receipt_customization"] }, pricesMinor: { monthlyMinor: 49000 }, isActive: true }],
    ["plan_pro", { id: "plan_pro", key: "pro", name: "Pro", allowances: { users: 50, products: 20000, registers: 10, branches: 0, features: ["reports", "customers", "receipt_customization", "advanced_reports", "employee_permissions", "expenses", "advanced_analytics"] }, pricesMinor: { monthlyMinor: 149000 }, isActive: true }],
    ["plan_enterprise", { id: "plan_enterprise", key: "enterprise", name: "Enterprise", allowances: { users: null, products: null, registers: null, branches: null, features: ["reports", "customers", "receipt_customization", "advanced_reports", "employee_permissions", "expenses", "advanced_analytics", "branches", "central_management", "api", "advanced_permissions", "integrations"] }, pricesMinor: { monthlyMinor: 0 }, isActive: true }],
  ]);
  const subscriptions = new Map<string, DbSubscription>();
  const invoices = new Map<string, DbInvoice>();
  const counters = new Map<string, DbUsageCounter>();
  const flags = new Map<string, DbFeatureFlag>();
  const webhookEvents = new Map<string, DbWebhookEvent>();
  const apiTokens = new Map<string, DbApiToken>();
  const printers = new Map<string, DbPrinter>();
  const printJobs = new Map<string, DbPrintJob>();
  const displayTokens = new Map<string, DbDisplayToken>();
  const emailVerifications = new Map<string, { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }>();
  const supportGrants = new Map<string, { id: string; purpose: string; actorId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }>();
  const managerApprovalGrants = new Map<string, { id: string; businessId: string; requesterId: string; approverId: string; permission: string; fingerprint: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }>();
  const shiftCorrections = new Map<string, DbShiftCorrection>();
  const receiptShares = new Map<string, { id: string; businessId: string; saleId: string; tokenHash: string; expiresAt: Date }>();
  const receiptDeliveries = new Map<string, DbReceiptDelivery>();
  const suppliers = new Map<string, DbSupplier>();
  const productSuppliers = new Map<string, DbProductSupplier>();
  const purchaseOrders = new Map<string, DbPurchaseOrder>();
  const purchaseOrderLines = new Map<string, DbPurchaseOrderLine>();
  const poSeq = new Map<string, number>();
  const purchaseReceipts = new Map<string, DbPurchaseReceipt>();
  const purchaseReceiptLines = new Map<string, DbPurchaseReceiptLine>();
  const receiptSeq = new Map<string, number>();
  const supplierReturns = new Map<string, DbSupplierReturn>();
  const supplierReturnLines = new Map<string, DbSupplierReturnLine>();
  const supplierReturnSeq = new Map<string, number>();
  const procurement = createMemoryProcurement({
    suppliers,
    productSuppliers,
    purchaseOrders,
    purchaseOrderLines,
    poSeq,
    purchaseReceipts,
    purchaseReceiptLines,
    receiptSeq,
    supplierReturns,
    supplierReturnLines,
    supplierReturnSeq,
    nextId: nid,
  });
  const audit: AuditEntry[] = [];
  const catalog = createMemoryCatalog({
    categories,
    products,
    productFamilies,
    productOptions,
    productOptionValues,
    variantOptionValues,
    productBundles,
    bundleComponents,
    nextId: nid,
  });

  const balanceKey = (businessId: string, branchId: string | null | undefined, productId: string): string =>
    `${businessId}:${branchId ?? ""}:${productId}`;
  const inventory = createMemoryInventory({
    movements,
    balances,
    inventoryCounts,
    inventoryCountLines,
    inventoryCountSeq,
    balanceKey,
    nextId: nid,
  });

  // Phase 12: the promise-chain locks move out of the individual services
  // into the port, so the PostgreSQL implementation can swap them for
  // transaction-scoped advisory locks without touching service code.
  const locks = new Map<string, Promise<void>>();
  let transactionDepth = 0;
  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === next) locks.delete(key);
    }
  }

  const memoryState: MemoryState = {
    users,
    businesses,
    memberships,
    sessions,
    resets,
    settings,
    categories,
    products,
    productFamilies,
    productOptions,
    productOptionValues,
    variantOptionValues,
    productBundles,
    bundleComponents,
    saleItemBundleComponents,
    movements,
    balances,
    inventoryCounts,
    inventoryCountLines,
    inventoryCountSeq,
    sales,
    saleItems,
    payments,
    heldSales,
    idempotency,
    purchaseReceiptSeq,
    registers,
    shifts,
    cashMovements,
    customers,
    giftCards,
    giftCardTransactions,
    storeCreditAccounts,
    storeCreditTransactions,
    loyaltyPrograms,
    loyaltyAccounts,
    loyaltyTransactions,
    saleGiftCardLoads,
    saleLoyalty,
    saleItemLoyaltyAllocations,
    refunds,
    refundItems,
    exchanges,
    expenses,
    branches,
    transfers,
    transferLines,
    devices,
    plans,
    subscriptions,
    invoices,
    counters,
    flags,
    webhookEvents,
    apiTokens,
    printers,
    printJobs,
    displayTokens,
    emailVerifications,
    supportGrants,
    managerApprovalGrants,
    shiftCorrections,
    receiptShares,
    receiptDeliveries,
    suppliers,
    productSuppliers,
    purchaseOrders,
    purchaseOrderLines,
    poSeq,
    purchaseReceipts,
    purchaseReceiptLines,
    receiptSeq,
    supplierReturns,
    supplierReturnLines,
    supplierReturnSeq,
    audit,
    nextId: nid,
    balanceKey,
  };
  const platform = createMemoryPlatform(memoryState);
  const salesFamily = createMemorySales(memoryState);

  const memoryDb: DbPort & { audit: AuditEntry[] } = {
    audit,
    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      return withLock(key, fn);
    },
    async withTransaction<T>(fn: (db: DbPort) => Promise<T>): Promise<T> {
      if (transactionDepth > 0) return fn(memoryDb);
      transactionDepth += 1;
      const snapshot = {
        purchaseOrders: new Map(purchaseOrders), purchaseOrderLines: new Map(purchaseOrderLines),
        purchaseReceipts: new Map(purchaseReceipts), purchaseReceiptLines: new Map(purchaseReceiptLines),
        supplierReturns: new Map(supplierReturns), supplierReturnLines: new Map(supplierReturnLines),
        movements: new Map(movements), balances: new Map(balances), idempotency: new Map(idempotency),
        sales: new Map(sales), saleItems: new Map(saleItems), payments: new Map(payments), refunds: new Map(refunds), refundItems: new Map(refundItems),
        giftCards: new Map(giftCards), giftCardTransactions: new Map(giftCardTransactions),
        storeCreditAccounts: new Map(storeCreditAccounts), storeCreditTransactions: new Map(storeCreditTransactions),
        loyaltyPrograms: new Map(loyaltyPrograms), loyaltyAccounts: new Map(loyaltyAccounts), loyaltyTransactions: new Map(loyaltyTransactions),
        saleGiftCardLoads: new Map(saleGiftCardLoads), saleLoyalty: new Map(saleLoyalty), saleItemLoyaltyAllocations: new Map(saleItemLoyaltyAllocations),
        inventoryCounts: new Map(inventoryCounts), inventoryCountLines: new Map(inventoryCountLines), inventoryCountSeq: new Map(inventoryCountSeq),
        audit: [...audit], poSeq: new Map(poSeq), purchaseReceiptSeq: new Map(purchaseReceiptSeq), supplierReturnSeq: new Map(supplierReturnSeq),
      };
      try {
        return await fn(memoryDb);
      } catch (error) {
        const restore = <T>(target: Map<string, T>, source: Map<string, T>): void => { target.clear(); for (const [id, row] of source) target.set(id, row); };
        restore(purchaseOrders, snapshot.purchaseOrders); restore(purchaseOrderLines, snapshot.purchaseOrderLines);
        restore(purchaseReceipts, snapshot.purchaseReceipts); restore(purchaseReceiptLines, snapshot.purchaseReceiptLines);
        restore(supplierReturns, snapshot.supplierReturns); restore(supplierReturnLines, snapshot.supplierReturnLines);
        restore(movements, snapshot.movements); restore(balances, snapshot.balances); restore(idempotency, snapshot.idempotency);
        restore(sales, snapshot.sales); restore(saleItems, snapshot.saleItems); restore(payments, snapshot.payments); restore(refunds, snapshot.refunds); restore(refundItems, snapshot.refundItems);
        restore(giftCards, snapshot.giftCards); restore(giftCardTransactions, snapshot.giftCardTransactions);
        restore(storeCreditAccounts, snapshot.storeCreditAccounts); restore(storeCreditTransactions, snapshot.storeCreditTransactions);
        restore(loyaltyPrograms, snapshot.loyaltyPrograms); restore(loyaltyAccounts, snapshot.loyaltyAccounts); restore(loyaltyTransactions, snapshot.loyaltyTransactions);
        restore(saleGiftCardLoads, snapshot.saleGiftCardLoads); restore(saleLoyalty, snapshot.saleLoyalty); restore(saleItemLoyaltyAllocations, snapshot.saleItemLoyaltyAllocations);
        restore(inventoryCounts, snapshot.inventoryCounts); restore(inventoryCountLines, snapshot.inventoryCountLines); restore(inventoryCountSeq, snapshot.inventoryCountSeq);
        restore(poSeq, snapshot.poSeq); restore(purchaseReceiptSeq, snapshot.purchaseReceiptSeq); restore(supplierReturnSeq, snapshot.supplierReturnSeq);
        audit.splice(0, audit.length, ...snapshot.audit);
        throw error;
      } finally { transactionDepth -= 1; }
    },
    async findUserByEmail(email) {
      for (const u of users.values()) if (u.email === email) return u;
      return null;
    },
    async findUserById(id) {
      return users.get(id) ?? null;
    },
    ...platform,
    ...catalog,
    ...inventory,
    ...salesFamily,
    ...procurement,
    async listAuditFor(businessId, entityType, entityId) {
      return audit.filter(
        (e) => e.businessId === businessId && e.entityType === entityType && e.entityId === entityId,
      );
    },

    async nextPurchaseReceiptNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (receiptSeq.get(businessId) ?? 0) + 1;
      receiptSeq.set(businessId, seq);
      return `GRN-${year}-${String(seq).padStart(6, "0")}`;
    },
    async createPurchaseReceipt(r) {
      const row = { ...r, id: nid("grn"), createdAt: new Date() };
      purchaseReceipts.set(row.id, row);
      return row;
    },
    async findPurchaseReceiptById(id, businessId) {
      const row = purchaseReceipts.get(id) ?? null;
      return row && row.businessId === businessId ? row : null;
    },
    async listPurchaseReceiptsByOrder(purchaseOrderId, businessId) {
      return [...purchaseReceipts.values()].filter((row) => row.purchaseOrderId === purchaseOrderId && row.businessId === businessId);
    },
    async createPurchaseReceiptLine(l) {
      const row = { ...l, id: nid("grnl"), createdAt: new Date() };
      purchaseReceiptLines.set(row.id, row);
      return row;
    },
    async listPurchaseReceiptLines(receiptId, businessId) {
      return [...purchaseReceiptLines.values()].filter((row) => row.purchaseReceiptId === receiptId && row.businessId === businessId);
    },
    async nextSupplierReturnNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (supplierReturnSeq.get(businessId) ?? 0) + 1;
      supplierReturnSeq.set(businessId, seq);
      return `SRT-${year}-${String(seq).padStart(6, "0")}`;
    },
    async createSupplierReturn(r) {
      const now = new Date();
      const row = { ...r, id: nid("sret"), createdAt: now, updatedAt: now };
      supplierReturns.set(row.id, row);
      return row;
    },
    async findSupplierReturnById(id, businessId) {
      const row = supplierReturns.get(id) ?? null;
      return row && row.businessId === businessId ? row : null;
    },
    async listSupplierReturnsByBusiness(businessId) {
      return [...supplierReturns.values()].filter((row) => row.businessId === businessId);
    },
    async listSupplierReturnsByOrder(purchaseOrderId, businessId) {
      return [...supplierReturns.values()].filter((row) => row.purchaseOrderId === purchaseOrderId && row.businessId === businessId);
    },
    async updateSupplierReturn(id, businessId, patch, expectedVersion) {
      const row = supplierReturns.get(id) ?? null;
      if (!row || row.businessId !== businessId || row.version !== expectedVersion) return null;
      const next = { ...row, ...patch, version: expectedVersion + 1, updatedAt: new Date() };
      supplierReturns.set(id, next);
      return next;
    },
    async createSupplierReturnLine(l) {
      const now = new Date();
      const row = { ...l, id: nid("sretl"), createdAt: now, updatedAt: now };
      supplierReturnLines.set(row.id, row);
      return row;
    },
    async listSupplierReturnLines(returnId, businessId) {
      return [...supplierReturnLines.values()].filter((row) => row.supplierReturnId === returnId && row.businessId === businessId);
    },
    async deleteSupplierReturnLines(returnId, businessId) {
      for (const [id, row] of supplierReturnLines) {
        if (row.supplierReturnId === returnId && row.businessId === businessId) supplierReturnLines.delete(id);
      }
    },
  };
  return memoryDb;
}

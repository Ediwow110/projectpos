import type { AuditEntry, DbApiToken, DbBalance, DbBranch, DbBusiness, DbCategory, DbCustomerConcern, DbCustomerConcernCreate, DbManagerApprovalRequest, DbManagerApprovalRequestCreate, DbDevice, DbDisplayToken, DbExchange, DbFeatureFlag, DbFulfillment, DbFulfillmentLine, DbInvoice, DbMembership, DbMovement, DbOrder, DbOrderAccessToken, DbOrderLine, DbPlan, DbPort, DbPrinter, DbPrintJob, DbProduct, DbProductFamily, DbProductOption, DbProductOptionValue, DbProductVariantOptionValue, DbProductBundle, DbBundleComponent, DbSaleItemBundleComponent, DbReceiptDelivery, DbResetToken, DbSession, DbShiftCorrection, DbStockTransfer, DbStockTransferLine, DbSubscription, DbUsageCounter, DbUser, DbSale, DbSaleItem, DbPayment, DbHeldSale, DbIdempotency, DbRegister, DbShift, DbCashMovement, DbCustomer, DbRefund, DbRefundItem, DbExpense, DbWebhookEvent, DbSupplier, DbProductSupplier, DbPurchaseOrder, DbPurchaseOrderLine, DbPurchaseReceipt, DbPurchaseReceiptLine, DbSupplierReturn, DbSupplierReturnLine, DbInventoryCount, DbInventoryCountLine, DbInventoryReservation, DbGiftCard, DbGiftCardTransaction, DbStoreCreditAccount, DbStoreCreditTransaction, DbLoyaltyProgram, DbLoyaltyAccount, DbLoyaltyTransaction, DbSaleGiftCardLoad, DbSaleLoyalty, DbSaleItemLoyaltyAllocation } from "./db.port";

import type { DbStockException } from "./db.port";
import type { DbGuestSupportCase, DbPlatformConsent } from "./db.port";
import { PRODUCT_MEDIA_ACTIVE_QUOTA_BYTES, type DbProductMediaAsset } from "./db.port";

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
  const productMedia = new Map<string, DbProductMediaAsset>();
  const productFamilies = new Map<string, DbProductFamily>();
  const productOptions = new Map<string, DbProductOption>();
  const productOptionValues = new Map<string, DbProductOptionValue>();
  const variantOptionValues = new Map<string, DbProductVariantOptionValue>();
  const productBundles = new Map<string, DbProductBundle>();
  const bundleComponents = new Map<string, DbBundleComponent>();
  const saleItemBundleComponents = new Map<string, DbSaleItemBundleComponent>();
  const movements = new Map<string, DbMovement>();
  const stockExceptions = new Map<string, DbStockException>();
  const guestSupportCases = new Map<string, DbGuestSupportCase>();
  const platformConsents = new Map<string, DbPlatformConsent>();
  const balances = new Map<string, DbBalance>();
  const inventoryCounts = new Map<string, DbInventoryCount>();
  const inventoryCountLines = new Map<string, DbInventoryCountLine>();
  const inventoryCountSeq = new Map<string, number>();
  const sales = new Map<string, DbSale>();
  const orders = new Map<string, DbOrder>();
  const orderLines = new Map<string, DbOrderLine>();
  const inventoryReservations = new Map<string, DbInventoryReservation>();
  const fulfillments = new Map<string, DbFulfillment>();
  const fulfillmentLines = new Map<string, DbFulfillmentLine>();
  const orderAccessTokens = new Map<string, DbOrderAccessToken>();
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
  const customerConcerns = new Map<string, DbCustomerConcern>();
  const managerApprovalRequests = new Map<string, DbManagerApprovalRequest>();
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
  const audit: AuditEntry[] = [];

  const balanceKey = (businessId: string, branchId: string | null | undefined, productId: string): string =>
    `${businessId}:${branchId ?? ""}:${productId}`;

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

  const memoryDb: DbPort & { audit: AuditEntry[] } = {
    audit,
    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      return withLock(key, fn);
    },
    async withTransaction<T>(fn: (db: DbPort) => Promise<T>): Promise<T> {
      if (transactionDepth > 0) return fn(memoryDb);
      transactionDepth += 1;
      const snapshot = {
        products: new Map(products), productMedia: new Map(productMedia),
        purchaseOrders: new Map(purchaseOrders), purchaseOrderLines: new Map(purchaseOrderLines),
        purchaseReceipts: new Map(purchaseReceipts), purchaseReceiptLines: new Map(purchaseReceiptLines),
        supplierReturns: new Map(supplierReturns), supplierReturnLines: new Map(supplierReturnLines),
        movements: new Map(movements), balances: new Map(balances), stockExceptions: new Map(stockExceptions), guestSupportCases: new Map(guestSupportCases), platformConsents: new Map(platformConsents), idempotency: new Map(idempotency),
        sales: new Map(sales), saleItems: new Map(saleItems), payments: new Map(payments), refunds: new Map(refunds), customerConcerns: new Map(customerConcerns), refundItems: new Map(refundItems),
        orders: new Map(orders), orderLines: new Map(orderLines), inventoryReservations: new Map(inventoryReservations),
        fulfillments: new Map(fulfillments), fulfillmentLines: new Map(fulfillmentLines), orderAccessTokens: new Map(orderAccessTokens),
        giftCards: new Map(giftCards), giftCardTransactions: new Map(giftCardTransactions),
        storeCreditAccounts: new Map(storeCreditAccounts), storeCreditTransactions: new Map(storeCreditTransactions),
        loyaltyPrograms: new Map(loyaltyPrograms), loyaltyAccounts: new Map(loyaltyAccounts), loyaltyTransactions: new Map(loyaltyTransactions),
        saleGiftCardLoads: new Map(saleGiftCardLoads), saleLoyalty: new Map(saleLoyalty), saleItemLoyaltyAllocations: new Map(saleItemLoyaltyAllocations),
        inventoryCounts: new Map(inventoryCounts), inventoryCountLines: new Map(inventoryCountLines), inventoryCountSeq: new Map(inventoryCountSeq),
        audit: [...audit], poSeq: new Map(poSeq), purchaseReceiptSeq: new Map(purchaseReceiptSeq), supplierReturnSeq: new Map(supplierReturnSeq),
        webhookEvents: new Map(webhookEvents),
      };
      try {
        return await fn(memoryDb);
      } catch (error) {
        const restore = <T>(target: Map<string, T>, source: Map<string, T>): void => { target.clear(); for (const [id, row] of source) target.set(id, row); };
        restore(purchaseOrders, snapshot.purchaseOrders); restore(purchaseOrderLines, snapshot.purchaseOrderLines);
        restore(products, snapshot.products); restore(productMedia, snapshot.productMedia);
        restore(purchaseReceipts, snapshot.purchaseReceipts); restore(purchaseReceiptLines, snapshot.purchaseReceiptLines);
        restore(supplierReturns, snapshot.supplierReturns); restore(supplierReturnLines, snapshot.supplierReturnLines);
        restore(movements, snapshot.movements); restore(balances, snapshot.balances); restore(stockExceptions, snapshot.stockExceptions); restore(guestSupportCases, snapshot.guestSupportCases); restore(platformConsents, snapshot.platformConsents); restore(idempotency, snapshot.idempotency);
        restore(sales, snapshot.sales); restore(saleItems, snapshot.saleItems); restore(payments, snapshot.payments); restore(refunds, snapshot.refunds); restore(customerConcerns, snapshot.customerConcerns); restore(refundItems, snapshot.refundItems);
        restore(orders, snapshot.orders); restore(orderLines, snapshot.orderLines); restore(inventoryReservations, snapshot.inventoryReservations);
        restore(fulfillments, snapshot.fulfillments); restore(fulfillmentLines, snapshot.fulfillmentLines); restore(orderAccessTokens, snapshot.orderAccessTokens);
        restore(giftCards, snapshot.giftCards); restore(giftCardTransactions, snapshot.giftCardTransactions);
        restore(storeCreditAccounts, snapshot.storeCreditAccounts); restore(storeCreditTransactions, snapshot.storeCreditTransactions);
        restore(loyaltyPrograms, snapshot.loyaltyPrograms); restore(loyaltyAccounts, snapshot.loyaltyAccounts); restore(loyaltyTransactions, snapshot.loyaltyTransactions);
        restore(saleGiftCardLoads, snapshot.saleGiftCardLoads); restore(saleLoyalty, snapshot.saleLoyalty); restore(saleItemLoyaltyAllocations, snapshot.saleItemLoyaltyAllocations);
        restore(inventoryCounts, snapshot.inventoryCounts); restore(inventoryCountLines, snapshot.inventoryCountLines); restore(inventoryCountSeq, snapshot.inventoryCountSeq);
        restore(poSeq, snapshot.poSeq); restore(purchaseReceiptSeq, snapshot.purchaseReceiptSeq); restore(supplierReturnSeq, snapshot.supplierReturnSeq);
        restore(webhookEvents, snapshot.webhookEvents);
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
    async createUser(u) {
      const row = { workspaceTourSeen: false, ...u, id: nid("user") };
      users.set(row.id, row);
      return row;
    },
    async updateUserPassword(id, passwordHash) {
      const u = users.get(id);
      if (u) users.set(id, { ...u, passwordHash });
    },
    async setUserEmailVerified(id, verified) {
      const u = users.get(id);
      if (u) users.set(id, { ...u, emailVerified: verified });
    },
    async setUserWorkspaceTourSeen(id, seen) {
      const u = users.get(id);
      if (u) users.set(id, { ...u, workspaceTourSeen: seen });
    },
    async createBusiness(b) {
      const row: DbBusiness = { ...b, storefrontKey: b.storefrontKey ?? null, id: nid("biz") };
      businesses.set(row.id, row);
      return row;
    },
    async findBusinessById(id) {
      return businesses.get(id) ?? null;
    },
    async findBusinessByStorefrontKey(key) {
      for (const row of businesses.values()) if (row.storefrontKey === key) return row;
      return null;
    },
    async setBusinessStorefrontKey(id, key) {
      for (const row of businesses.values()) {
        if (row.id !== id && row.storefrontKey === key) throw new Error("CONFLICT");
      }
      const current = businesses.get(id) ?? null;
      if (!current) return null;
      const next = { ...current, storefrontKey: key };
      businesses.set(id, next);
      return next;
    },
    async listMembershipsByUser(userId) {
      return [...memberships.values()].filter((m) => m.userId === userId);
    },
    async listMembershipsByBusiness(businessId) {
      return [...memberships.values()].filter((m) => m.businessId === businessId);
    },
    async findLatestSaleForRegister(businessId, registerId) {
      let latest = null;
      for (const s of sales.values()) {
        if (s.businessId !== businessId || s.registerId !== registerId) continue;
        if (s.status !== "COMPLETED") continue;
        if (!latest || s.createdAt.getTime() > latest.createdAt.getTime()) latest = s;
      }
      return latest;
    },
    async hasShiftForRegister(businessId, registerId) {
      for (const s of shifts.values()) {
        if (s.businessId === businessId && s.registerId === registerId) return true;
      }
      return false;
    },
    async findMembership(userId, businessId) {
      for (const m of memberships.values()) {
        if (m.userId === userId && m.businessId === businessId) return m;
      }
      return null;
    },
    async createMembership(m) {
      const row = { ...m, id: nid("mem") };
      memberships.set(row.id, row);
      return row;
    },
    async updateMembership(id, businessId, patch) {
      const m = memberships.get(id);
      if (m && m.businessId === businessId) memberships.set(id, { ...m, ...patch });
    },
    async createSession(s) {
      const row = { ...s, id: nid("sess") };
      sessions.set(row.id, row);
      return row;
    },
    async updateSession(id, patch) {
      const s = sessions.get(id);
      if (s) sessions.set(id, { ...s, ...patch });
    },
    async findSessionByTokenHash(tokenHash) {
      for (const s of sessions.values()) if (s.tokenHash === tokenHash) return s;
      return null;
    },
    async listSessionsByUser(userId) {
      return [...sessions.values()].filter((s) => s.userId === userId && s.revokedAt === null);
    },
    async revokeSession(id) {
      const s = sessions.get(id);
      if (s) sessions.set(id, { ...s, revokedAt: new Date() });
    },
    async revokeAllUserSessions(userId, exceptId) {
      for (const s of sessions.values()) {
        if (s.userId === userId && s.id !== exceptId) sessions.set(s.id, { ...s, revokedAt: new Date() });
      }
    },
    async saveResetToken(t) {
      resets.set(t.tokenHash, t);
    },
    async findResetToken(tokenHash) {
      return resets.get(tokenHash) ?? null;
    },
    async markResetTokenUsed(tokenHash, usedAt) {
      const t = resets.get(tokenHash);
      if (t) resets.set(tokenHash, { ...t, usedAt });
    },
    async createEmailVerificationToken(t) {
      const row = { ...t, usedAt: null, id: nid("evt") };
      emailVerifications.set(row.tokenHash, row);
      return { id: row.id };
    },
    async findEmailVerificationToken(tokenHash) {
      return emailVerifications.get(tokenHash) ?? null;
    },
    async markEmailVerificationTokenUsed(id) {
      for (const t of emailVerifications.values()) {
        if (t.id === id) emailVerifications.set(t.tokenHash, { ...t, usedAt: new Date() });
      }
    },
    async createSupportGrant(g) {
      const row = { ...g, usedAt: null, id: nid("sup") };
      supportGrants.set(row.tokenHash, row);
      return { id: row.id };
    },
    async findValidSupportGrant(tokenHash) {
      const g = supportGrants.get(tokenHash);
      if (!g || g.usedAt !== null || g.expiresAt.getTime() <= Date.now()) return null;
      return g;
    },
    async markSupportGrantUsed(id) {
      for (const g of supportGrants.values()) {
        if (g.id === id) supportGrants.set(g.tokenHash, { ...g, usedAt: new Date() });
      }
    },
    async createManagerApprovalGrant(g) {
      const row = { ...g, usedAt: null, id: nid("mag") };
      managerApprovalGrants.set(row.tokenHash, row);
      return { id: row.id };
    },
    async findValidManagerApprovalGrant(tokenHash, businessId, requesterId, permission) {
      const g = managerApprovalGrants.get(tokenHash);
      if (
        !g ||
        g.usedAt !== null ||
        g.expiresAt.getTime() <= Date.now() ||
        g.businessId !== businessId ||
        g.requesterId !== requesterId ||
        g.permission !== permission
      ) return null;
      return { id: g.id, approverId: g.approverId, fingerprint: g.fingerprint, expiresAt: g.expiresAt };
    },
    async markManagerApprovalGrantUsed(id) {
      for (const g of managerApprovalGrants.values()) {
        if (g.id === id) managerApprovalGrants.set(g.tokenHash, { ...g, usedAt: new Date() });
      }
    },
    async createShiftCorrection(c) {
      const row = { ...c, id: nid("shcor"), createdAt: new Date() };
      shiftCorrections.set(row.id, row);
      return row;
    },
    async listShiftCorrections(businessId, shiftId) {
      return [...shiftCorrections.values()]
        .filter((c) => c.businessId === businessId && c.shiftId === shiftId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async createReceiptShare(s) {
      const row = { ...s, id: nid("rsh") };
      receiptShares.set(row.tokenHash, row);
      return { id: row.id };
    },
    async findValidReceiptShare(tokenHash) {
      const r = receiptShares.get(tokenHash);
      if (!r || r.expiresAt.getTime() <= Date.now()) return null;
      return r;
    },
    async claimReceiptDelivery(d) {
      const existing = [...receiptDeliveries.values()].find(
        (row) => row.businessId === d.businessId && row.idempotencyKey === d.idempotencyKey,
      );
      if (existing) return { delivery: existing, claimed: false };
      const row: DbReceiptDelivery = { ...d, id: nid("rdl"), createdAt: new Date() };
      receiptDeliveries.set(row.id, row);
      return { delivery: row, claimed: true };
    },
    async updateReceiptDelivery(id, businessId, patch) {
      const row = receiptDeliveries.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      const next = { ...row, ...patch };
      receiptDeliveries.set(id, next);
      return next;
    },
    async listReceiptDeliveries(businessId, saleId) {
      return [...receiptDeliveries.values()]
        .filter((row) => row.businessId === businessId && row.saleId === saleId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async getSettings(businessId) {
      return settings.get(businessId) ?? {};
    },
    async saveSettings(businessId, next) {
      settings.set(businessId, next);
    },
    async appendAudit(e) {
      // Phase 11: every audit row is orderable (PLAN 6.7) — stamp the time
      // when the caller does not supply one.
      audit.push({ ...e, at: e.at ?? new Date() });
    },
    async listAudit() {
      return audit;
    },
    async createCategory(c) {
      const row = { ...c, id: nid("cat") };
      categories.set(row.id, row);
      return row;
    },
    async listCategories(businessId) {
      return [...categories.values()].filter((c) => c.businessId === businessId);
    },
    async findCategoryById(id, businessId) {
      const c = categories.get(id) ?? null;
      if (!c || c.businessId !== businessId) return null;
      return c;
    },
    async updateCategory(id, businessId, patch) {
      const c = categories.get(id) ?? null;
      if (!c || c.businessId !== businessId) return null;
      const next = { ...c, ...patch };
      categories.set(id, next);
      return next;
    },
    async createProduct(p) {
      const row = { ...p, id: nid("prod") };
      products.set(row.id, row);
      return row;
    },
    async listProducts(businessId) {
      return [...products.values()].filter((p) => p.businessId === businessId);
    },
    async findProductById(id, businessId) {
      const p = products.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      return p;
    },
    async updateProduct(id, businessId, patch) {
      const p = products.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      const next = { ...p, ...patch };
      products.set(id, next);
      return next;
    },
    async getActiveProductMedia(businessId, productId) {
      return [...productMedia.values()].find((asset) =>
        asset.businessId === businessId && asset.productId === productId && asset.state === "ACTIVE") ?? null;
    },
    async replaceProductMediaAtomic(businessId, productId, expectedAssetId, input, requestId) {
      return withLock(`product-media-quota:${businessId}`, () => memoryDb.withTransaction(async () => {
        const current = products.get(productId);
        if (!current || current.businessId !== businessId) throw new Error("NOT_FOUND");
        if (input.businessId !== businessId || input.productId !== productId ||
          input.contentType !== "image/webp" || !Number.isSafeInteger(input.bytes) ||
          input.bytes <= 0 || input.bytes > 1024 * 1024 ||
          !Number.isInteger(input.width) || input.width < 1 || input.width > 1600 ||
          !Number.isInteger(input.height) || input.height < 1 || input.height > 1600 ||
          !input.storagePath.startsWith(`businesses/${businessId}/products/${productId}/`) ||
          !input.storagePath.endsWith(".webp") ||
          [...productMedia.values()].some((asset) => asset.storagePath === input.storagePath)) {
          throw new Error("PRODUCT_MEDIA_INVALID");
        }
        const oldAsset = await memoryDb.getActiveProductMedia(businessId, productId);
        if ((oldAsset?.id ?? null) !== expectedAssetId) throw new Error("PRODUCT_MEDIA_CONFLICT");
        const total = [...productMedia.values()].filter((asset) =>
          asset.businessId === businessId && asset.state === "ACTIVE")
          .reduce((sum, asset) => sum + asset.bytes, 0);
        if (total - (oldAsset?.bytes ?? 0) + input.bytes > PRODUCT_MEDIA_ACTIVE_QUOTA_BYTES) {
          throw new Error("PRODUCT_MEDIA_QUOTA");
        }
        const now = new Date();
        if (oldAsset) productMedia.set(oldAsset.id, { ...oldAsset, state: "SUPERSEDED", updatedAt: now });
        const asset: DbProductMediaAsset = {
          ...input, id: nid("media"), state: "ACTIVE", cleanupAttempts: 0,
          lastCleanupAt: null, createdAt: now, updatedAt: now,
        };
        productMedia.set(asset.id, asset);
        const product = { ...current, imageUrl: input.publicUrl };
        products.set(productId, product);
        if (requestId) await memoryDb.appendAudit({
          businessId, actorId: input.actorId, action: "product.media.upload",
          entityType: "Product", entityId: productId, requestId,
        });
        return { product, asset, oldAsset };
      }));
    },
    async detachProductMediaAtomic(businessId, productId, expectedAssetId, actorId, requestId) {
      return withLock(`product-media-quota:${businessId}`, () => memoryDb.withTransaction(async () => {
        const current = products.get(productId);
        if (!current || current.businessId !== businessId) throw new Error("NOT_FOUND");
        const oldAsset = await memoryDb.getActiveProductMedia(businessId, productId);
        if ((oldAsset?.id ?? null) !== expectedAssetId) throw new Error("PRODUCT_MEDIA_CONFLICT");
        if (oldAsset) productMedia.set(oldAsset.id, {
          ...oldAsset, state: "PENDING_DELETE", updatedAt: new Date(),
        });
        const product = { ...current, imageUrl: null };
        products.set(productId, product);
        if (actorId && requestId) await memoryDb.appendAudit({
          businessId, actorId, action: "product.media.remove",
          entityType: "Product", entityId: productId, requestId,
        });
        return { product, oldAsset };
      }));
    },
    async listProductMediaCleanupCandidates(limit) {
      return [...productMedia.values()].filter((asset) => asset.state !== "ACTIVE")
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .slice(0, Math.max(0, Math.min(100, limit)));
    },
    async markProductMediaCleanupResult(businessId, assetId, succeeded) {
      const asset = productMedia.get(assetId);
      if (!asset || asset.businessId !== businessId || asset.state === "ACTIVE") return;
      if (succeeded) productMedia.delete(assetId);
      else productMedia.set(assetId, { ...asset, cleanupAttempts: asset.cleanupAttempts + 1,
        lastCleanupAt: new Date(), updatedAt: new Date() });
    },
    async createProductFamily(f) {
      const now = new Date(); const row = { ...f, id: nid("pfam"), createdAt: now, updatedAt: now };
      productFamilies.set(row.id, row); return row;
    },
    async listProductFamilies(businessId) { return [...productFamilies.values()].filter((r) => r.businessId === businessId); },
    async findProductFamilyById(id, businessId) { const row = productFamilies.get(id) ?? null; return row && row.businessId === businessId ? row : null; },
    async updateProductFamily(id, businessId, patch) {
      const row = productFamilies.get(id) ?? null; if (!row || row.businessId !== businessId) return null;
      const next = { ...row, ...patch, updatedAt: new Date() }; productFamilies.set(id, next); return next;
    },
    async createProductOption(o) { const now = new Date(); const row = { ...o, id: nid("popt"), createdAt: now, updatedAt: now }; productOptions.set(row.id, row); return row; },
    async listProductOptions(familyId, businessId) { return [...productOptions.values()].filter((r) => r.familyId === familyId && r.businessId === businessId).sort((a, b) => a.position - b.position); },
    async findProductOptionById(id, businessId) { const row = productOptions.get(id) ?? null; return row && row.businessId === businessId ? row : null; },
    async updateProductOption(id, businessId, patch) { const row = productOptions.get(id) ?? null; if (!row || row.businessId !== businessId) return null; const next = { ...row, ...patch, updatedAt: new Date() }; productOptions.set(id, next); return next; },
    async createProductOptionValue(v) { const now = new Date(); const row = { ...v, isActive: v.isActive ?? true, id: nid("pval"), createdAt: now, updatedAt: now }; productOptionValues.set(row.id, row); return row; },
    async listProductOptionValues(optionId, businessId) { return [...productOptionValues.values()].filter((r) => r.optionId === optionId && r.businessId === businessId).sort((a, b) => a.position - b.position); },
    async findProductOptionValueById(id, businessId) { const row = productOptionValues.get(id) ?? null; return row && row.businessId === businessId ? row : null; },
    async updateProductOptionValue(id, businessId, patch) { const row = productOptionValues.get(id) ?? null; if (!row || row.businessId !== businessId) return null; const next = { ...row, ...patch, updatedAt: new Date() }; productOptionValues.set(id, next); return next; },
    async createVariantOptionValue(v) { const row = { ...v, id: nid("pvo"), createdAt: new Date() }; variantOptionValues.set(row.id, row); return row; },
    async listVariantOptionValues(productId, businessId) { return [...variantOptionValues.values()].filter((r) => r.productId === productId && r.businessId === businessId); },
    async deleteVariantOptionValues(productId, businessId) { for (const [id, row] of variantOptionValues) if (row.productId === productId && row.businessId === businessId) variantOptionValues.delete(id); },
    async createProductBundle(b) { const now = new Date(); const row = { ...b, id: nid("bun"), createdAt: now, updatedAt: now }; productBundles.set(row.id, row); return row; },
    async findProductBundleByProductId(productId, businessId) { return [...productBundles.values()].find((r) => r.bundleProductId === productId && r.businessId === businessId) ?? null; },
    async findProductBundleById(id, businessId) { const row = productBundles.get(id) ?? null; return row && row.businessId === businessId ? row : null; },
    async updateProductBundle(id, businessId, patch) { const row = productBundles.get(id) ?? null; if (!row || row.businessId !== businessId) return null; const next = { ...row, ...patch, updatedAt: new Date() }; productBundles.set(id, next); return next; },
    async createBundleComponent(c) { const now = new Date(); const row = { ...c, id: nid("bc"), createdAt: now, updatedAt: now }; bundleComponents.set(row.id, row); return row; },
    async listBundleComponents(bundleId, businessId) { return [...bundleComponents.values()].filter((r) => r.bundleId === bundleId && r.businessId === businessId).sort((a, b) => a.position - b.position); },
    async deleteBundleComponents(bundleId, businessId) { for (const [id, row] of bundleComponents) if (row.bundleId === bundleId && row.businessId === businessId) bundleComponents.delete(id); },
    async createMovement(m) {
      const row = { ...m, id: nid("mov") };
      movements.set(row.id, row);
      return row;
    },
    async listMovements(productId, businessId, branchId?) {
      return [...movements.values()].filter(
        (m) =>
          m.productId === productId &&
          m.businessId === businessId &&
          (branchId === undefined || (m.branchId ?? null) === (branchId ?? null)),
      );
    },
    async listMovementsByBusiness(businessId) {
      return [...movements.values()].filter((m) => m.businessId === businessId);
    },
    async listMovementsPage(businessId, afterId, limit) {
      const rows = [...movements.values()]
        .filter((m) => m.businessId === businessId && (afterId === null || m.id > afterId))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.slice(0, limit);
    },
    async upsertBalance(b) {
      const key = balanceKey(b.businessId, b.branchId, b.productId);
      const existing = balances.get(key);
      const row = existing ? { ...existing, qtyOnHand: b.qtyOnHand, updatedAt: new Date() } : { ...b, id: nid("bal"), updatedAt: new Date() };
      balances.set(key, row);
      return row;
    },
    async findBalance(productId, businessId, branchId = null) {
      const row = balances.get(balanceKey(businessId, branchId, productId)) ?? null;
      if (!row || row.businessId !== businessId) return null;
      return row;
    },
    async listBalances(businessId) {
      return [...balances.values()].filter((b) => b.businessId === businessId);
    },
    async createStockException(input) {
      const product = products.get(input.productId);
      if (!product || product.businessId !== input.businessId) throw new Error("NOT_FOUND");
      const row: DbStockException = { ...input, id: nid("risk"), createdAt: new Date() };
      if ([...stockExceptions.values()].some((value) => value.businessId === input.businessId && value.reportKey === input.reportKey)) throw new Error("CONFLICT");
      stockExceptions.set(row.id, row);
      return row;
    },
    async findStockExceptionById(id, businessId) {
      const row = stockExceptions.get(id);
      return row?.businessId === businessId ? row : null;
    },
    async findStockExceptionByKey(businessId, key) {
      return [...stockExceptions.values()].find((row) => row.businessId === businessId && row.reportKey === key) ?? null;
    },
    async listStockExceptions(businessId) {
      return [...stockExceptions.values()].filter((row) => row.businessId === businessId);
    },
    async disposeStockException(id, businessId, actorId, movementId) {
      const row = stockExceptions.get(id);
      if (!row || row.businessId !== businessId || row.status !== "OPEN") return null;
      const next: DbStockException = { ...row, status: "DISPOSED", disposedBy: actorId, disposedAt: new Date(), movementId };
      stockExceptions.set(id, next);
      return next;
    },
    async createGuestSupportCase(input) {
      const order = orders.get(input.orderId);
      if (!order || order.businessId !== input.businessId) throw new Error("NOT_FOUND");
      if ([...guestSupportCases.values()].some((row) => row.businessId === input.businessId && row.idempotencyKey === input.idempotencyKey)) throw new Error("CONFLICT");
      const row: DbGuestSupportCase = { ...input, id: nid("gsc"), createdAt: new Date() };
      guestSupportCases.set(row.id, row); return row;
    },
    async findGuestSupportCaseById(id, businessId) {
      const row = guestSupportCases.get(id);
      return row?.businessId === businessId ? row : null;
    },
    async findGuestSupportCaseByKey(businessId, key) {
      return [...guestSupportCases.values()].find((row) => row.businessId === businessId && row.idempotencyKey === key) ?? null;
    },
    async listGuestSupportCases(businessId) {
      return [...guestSupportCases.values()].filter((row) => row.businessId === businessId);
    },
    async countOpenGuestSupportCases(businessId) {
      let count = 0;
      for (const row of guestSupportCases.values()) {
        if (row.businessId === businessId && row.status === "OPEN") count++;
      }
      return count;
    },
    async listGuestSupportCasesForOrder(businessId, orderId) {
      return [...guestSupportCases.values()]
        .filter((row) => row.businessId === businessId && row.orderId === orderId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    },
    async closeGuestSupportCase(id, businessId, actorId) {
      const row = guestSupportCases.get(id);
      if (!row || row.businessId !== businessId || row.status !== "OPEN") return null;
      const next: DbGuestSupportCase = { ...row, status: "CLOSED", closedAt: new Date(), closedBy: actorId };
      guestSupportCases.set(id, next); return next;
    },
    async createPlatformConsent(input) {
      const row: DbPlatformConsent = { ...input, id: nid("consent"), createdAt: new Date() };
      platformConsents.set(row.id, row); return row;
    },
    async findPlatformConsentById(id, businessId) {
      const row = platformConsents.get(id);
      return row?.businessId === businessId ? row : null;
    },
    async findPlatformConsentByHash(businessId, hash) {
      return [...platformConsents.values()].find((row) => row.businessId === businessId && row.tokenHash === hash) ?? null;
    },
    async listPlatformConsents(businessId) {
      return [...platformConsents.values()].filter((row) => row.businessId === businessId);
    },
    async revokePlatformConsent(id, businessId) {
      const row = platformConsents.get(id);
      if (!row || row.businessId !== businessId) return null;
      const next: DbPlatformConsent = { ...row, revokedAt: row.revokedAt ?? new Date() };
      platformConsents.set(id, next); return next;
    },
    async nextInventoryCountNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (inventoryCountSeq.get(businessId) ?? 0) + 1;
      inventoryCountSeq.set(businessId, seq);
      return `CNT-${year}-${String(seq).padStart(6, "0")}`;
    },
    async createInventoryCount(c) {
      const now = new Date();
      const row: DbInventoryCount = { ...c, id: nid("cnt"), createdAt: now, updatedAt: now };
      inventoryCounts.set(row.id, row);
      return row;
    },
    async findInventoryCountById(id, businessId) {
      const row = inventoryCounts.get(id) ?? null;
      return row && row.businessId === businessId ? row : null;
    },
    async listInventoryCountsByBusiness(businessId) {
      return [...inventoryCounts.values()].filter((row) => row.businessId === businessId);
    },
    async updateInventoryCount(id, businessId, patch, expectedVersion) {
      const row = inventoryCounts.get(id) ?? null;
      if (!row || row.businessId !== businessId || row.version !== expectedVersion) return null;
      const next = { ...row, ...patch, version: expectedVersion + 1, updatedAt: new Date() };
      inventoryCounts.set(id, next);
      return next;
    },
    async createInventoryCountLine(l) {
      const now = new Date();
      const row: DbInventoryCountLine = { ...l, id: nid("cntl"), createdAt: now, updatedAt: now };
      inventoryCountLines.set(row.id, row);
      return row;
    },
    async listInventoryCountLines(countId, businessId) {
      return [...inventoryCountLines.values()].filter((row) => row.inventoryCountId === countId && row.businessId === businessId);
    },
    async updateInventoryCountLine(id, businessId, patch) {
      const row = inventoryCountLines.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      const next = { ...row, ...patch, updatedAt: new Date() };
      inventoryCountLines.set(id, next);
      return next;
    },
    async deleteInventoryCountLines(countId, businessId) {
      for (const [id, row] of inventoryCountLines) if (row.inventoryCountId === countId && row.businessId === businessId) inventoryCountLines.delete(id);
    },
    async createSale(s) {
      const row: DbSale = {
        completedAt: null,
        voidedAt: null,
        voidReason: null,
        deliveryFeeMinor: 0,
        deliveryTaxMinor: 0,
        ...s,
        id: nid("sale"),
      };
      sales.set(row.id, row);
      return row;
    },
    async findSaleById(id, businessId) {
      const s = sales.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      return s;
    },
    async findSaleByReceiptNo(receiptNo, businessId) {
      return [...sales.values()].find((s) => s.businessId === businessId && s.receiptNo === receiptNo) ?? null;
    },
    async listSalesByBusiness(businessId) {
      return [...sales.values()].filter((s) => s.businessId === businessId);
    },
    async countSalesByBusiness(businessId) {
      let count = 0;
      for (const row of sales.values()) if (row.businessId === businessId) count++;
      return count;
    },
    async listSalesPage(businessId, afterId, limit) {
      const rows = [...sales.values()]
        .filter((s) => s.businessId === businessId && (afterId === null || s.id > afterId))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.slice(0, limit);
    },
    async updateSale(id, businessId, patch) {
      const s = sales.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch };
      sales.set(id, next);
      return next;
    },
    async createOrder(o) {
      if (o.saleId && [...orders.values()].some((row) => row.saleId === o.saleId)) throw new Error("CONFLICT");
      const row: DbOrder = { ...o, id: nid("ord") };
      orders.set(row.id, row);
      return row;
    },
    async findOrderById(id, businessId) {
      const row = orders.get(id) ?? null;
      return row && row.businessId === businessId ? row : null;
    },
    async findOrderBySaleId(saleId, businessId) {
      return [...orders.values()].find((row) => row.businessId === businessId && row.saleId === saleId) ?? null;
    },
    async updateOrder(id, businessId, patch, expectedVersion) {
      const row = orders.get(id) ?? null;
      if (!row || row.businessId !== businessId || row.version !== expectedVersion) return null;
      if (patch.saleId && [...orders.values()].some((other) => other.id !== id && other.saleId === patch.saleId)) throw new Error("CONFLICT");
      const next: DbOrder = { ...row, ...patch, version: expectedVersion + 1, updatedAt: new Date() };
      orders.set(id, next);
      return next;
    },
    async listOrdersPage(businessId, query) {
      const paymentStatusFor = (row: DbOrder): string => {
        if (!row.saleId) return "UNPAID";
        const sale = sales.get(row.saleId);
        if (!sale || sale.businessId !== businessId) return "UNPAID";
        const saleRefunds = [...refunds.values()].filter((r) => r.businessId === businessId && r.saleId === sale.id && r.status === "APPROVED");
        const refundTotal = saleRefunds.reduce((sum, r) => sum + r.totalMinor, 0);
        if (sale.status === "REFUNDED" || (sale.totalMinor > 0 && refundTotal >= sale.totalMinor)) return "REFUNDED";
        if (sale.status === "PARTIALLY_REFUNDED" || refundTotal > 0) return "PARTIALLY_REFUNDED";
        const salePayments = [...payments.values()].filter((p) => p.businessId === businessId && p.saleId === sale.id);
        if (salePayments.some((p) => p.status === "UNKNOWN")) return "UNKNOWN";
        const succeeded = salePayments.filter((p) => p.status === "SUCCEEDED").reduce((sum, p) => sum + p.amountMinor, 0);
        if (sale.totalMinor > 0 && succeeded >= sale.totalMinor) return "PAID";
        if (sale.status === "PENDING_PAYMENT") return "PENDING";
        if (sale.status === "PAYMENT_FAILED") return "FAILED";
        if (sale.status === "PAYMENT_UNKNOWN") return "UNKNOWN";
        if (sale.status === "RECONCILED") return salePayments.some((p) => p.status === "FAILED") ? "FAILED" : "PENDING";
        if (["PAID", "COMPLETED", "REFUND_REQUESTED"].includes(sale.status)) return "PAID";
        return "UNPAID";
      };
      return [...orders.values()]
        .filter((row) => row.businessId === businessId)
        .filter((row) => !query.status || row.status === query.status)
        .filter((row) => !query.channel || row.channel === query.channel)
        .filter((row) => !query.fulfillmentMode || row.fulfillmentMode === query.fulfillmentMode)
        .filter((row) => !query.branchId || row.branchId === query.branchId)
        .filter((row) => !query.paymentStatus || paymentStatusFor(row) === query.paymentStatus)
        .filter((row) => !query.dateFrom || row.createdAt.getTime() >= query.dateFrom.getTime())
        .filter((row) => !query.dateTo || row.createdAt.getTime() <= query.dateTo.getTime())
        .filter((row) => !query.cursor || row.createdAt.getTime() < query.cursor.createdAt.getTime() ||
          (row.createdAt.getTime() === query.cursor.createdAt.getTime() && row.id < query.cursor.id))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .slice(0, query.limit);
    },
    async listDueReservationOrders(now, limit) {
      const ids = new Set(
        [...inventoryReservations.values()]
          .filter((row) => row.status === "HELD" && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())
          .map((row) => row.orderId),
      );
      return [...orders.values()]
        .filter((row) => ids.has(row.id))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    async listAgedOperationalReservations(cutoff, limit) {
      return [...inventoryReservations.values()]
        .filter((row) => row.status === "HELD" && row.expiresAt === null && row.createdAt.getTime() <= cutoff.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    async createOrderLine(l) {
      const row: DbOrderLine = { ...l, id: nid("ol") };
      if ([...orderLines.values()].some((other) => other.businessId === row.businessId && other.orderId === row.orderId && other.position === row.position)) {
        throw new Error("CONFLICT");
      }
      orderLines.set(row.id, row);
      return row;
    },
    async listOrderLines(orderId, businessId) {
      return [...orderLines.values()]
        .filter((row) => row.orderId === orderId && row.businessId === businessId)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    },
    async deleteOrderLines(orderId, businessId) {
      for (const [id, row] of orderLines) {
        if (row.orderId === orderId && row.businessId === businessId) orderLines.delete(id);
      }
    },
    async createInventoryReservation(r) {
      if ([...inventoryReservations.values()].some((row) => row.businessId === r.businessId && row.idempotencyKey === r.idempotencyKey)) {
        throw new Error("CONFLICT");
      }
      const row: DbInventoryReservation = { ...r, id: nid("res") };
      inventoryReservations.set(row.id, row);
      return row;
    },
    async listReservationsByOrder(orderId, businessId) {
      return [...inventoryReservations.values()]
        .filter((row) => row.orderId === orderId && row.businessId === businessId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },
    async listActiveReservationsByProduct(businessId, branchId, productId) {
      return [...inventoryReservations.values()]
        .filter((row) => row.businessId === businessId && row.branchId === branchId && row.productId === productId && row.status === "HELD")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },
    async updateInventoryReservation(id, businessId, patch) {
      const row = inventoryReservations.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      const next: DbInventoryReservation = { ...row, ...patch, updatedAt: new Date() };
      inventoryReservations.set(id, next);
      return next;
    },
    async createFulfillment(f) {
      const row: DbFulfillment = { ...f, id: nid("ful") };
      fulfillments.set(row.id, row);
      return row;
    },
    async findFulfillmentById(id, businessId) {
      const row = fulfillments.get(id) ?? null;
      return row && row.businessId === businessId ? row : null;
    },
    async listFulfillmentsByOrder(orderId, businessId) {
      return [...fulfillments.values()]
        .filter((row) => row.orderId === orderId && row.businessId === businessId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },
    async updateFulfillment(id, businessId, patch, expectedVersion) {
      const row = fulfillments.get(id) ?? null;
      if (!row || row.businessId !== businessId || row.version !== expectedVersion) return null;
      const next: DbFulfillment = { ...row, ...patch, version: expectedVersion + 1, updatedAt: new Date() };
      fulfillments.set(id, next);
      return next;
    },
    async createFulfillmentLine(l) {
      if ([...fulfillmentLines.values()].some((row) => row.businessId === l.businessId && row.fulfillmentId === l.fulfillmentId && row.orderLineId === l.orderLineId)) {
        throw new Error("CONFLICT");
      }
      const row: DbFulfillmentLine = { ...l, id: nid("fl") };
      fulfillmentLines.set(row.id, row);
      return row;
    },
    async listFulfillmentLines(fulfillmentId, businessId) {
      return [...fulfillmentLines.values()]
        .filter((row) => row.fulfillmentId === fulfillmentId && row.businessId === businessId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },
    async createOrderAccessToken(t) {
      if ([...orderAccessTokens.values()].some((row) => row.tokenHash === t.tokenHash)) throw new Error("CONFLICT");
      const row: DbOrderAccessToken = { ...t, id: nid("oat") };
      orderAccessTokens.set(row.id, row);
      return row;
    },
    async findOrderAccessTokenByHash(tokenHash) {
      return [...orderAccessTokens.values()].find((row) => row.tokenHash === tokenHash) ?? null;
    },
    async listActiveOrderAccessTokens(orderId, businessId, kind, now) {
      return [...orderAccessTokens.values()]
        .filter((row) => row.orderId === orderId && row.businessId === businessId && row.kind === kind && row.revokedAt === null && row.expiresAt.getTime() > now.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },
    async revokeOrderAccessToken(id, businessId, revokedAt) {
      const row = orderAccessTokens.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      const next = { ...row, revokedAt };
      orderAccessTokens.set(id, next);
      return next;
    },
    async createSaleItem(i) {
      const nextPosition =
        i.position ??
        [...saleItems.values()].filter(
          (item) => item.saleId === i.saleId && item.businessId === i.businessId,
        ).length;
      const row = { ...i, position: nextPosition, id: nid("sitem") };
      saleItems.set(row.id, row);
      return row;
    },
    async listSaleItems(saleId, businessId) {
      return [...saleItems.values()]
        .filter((i) => i.saleId === saleId && i.businessId === businessId)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    },
    async listSaleItemsByBusiness(businessId) {
      return [...saleItems.values()].filter((i) => i.businessId === businessId);
    },
    async createSaleItemBundleComponent(c) { const row = { ...c, id: nid("sbc"), createdAt: new Date() }; saleItemBundleComponents.set(row.id, row); return row; },
    async listSaleItemBundleComponents(saleItemId, businessId) { return [...saleItemBundleComponents.values()].filter((r) => r.saleItemId === saleItemId && r.businessId === businessId); },
    async createPayment(p) {
      const row = { internalInstrumentType: null, internalInstrumentId: null, ...p, id: nid("pay") };
      payments.set(row.id, row);
      return row;
    },
    async findPaymentById(id, businessId) {
      const p = payments.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      return p;
    },
    async listPaymentsBySale(saleId, businessId) {
      return [...payments.values()].filter(
        (p) => p.saleId === saleId && p.businessId === businessId,
      );
    },
    async listPaymentsByBusiness(businessId) {
      return [...payments.values()].filter((p) => p.businessId === businessId);
    },
    async updatePayment(id, businessId, patch) {
      const p = payments.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      const next = { ...p, ...patch };
      payments.set(id, next);
      return next;
    },
    async createHeldSale(h) {
      const row = { ...h, id: nid("held") };
      heldSales.set(row.id, row);
      return row;
    },
    async findHeldSaleById(id, businessId) {
      const h = heldSales.get(id) ?? null;
      if (!h || h.businessId !== businessId) return null;
      return h;
    },
    async listHeldSales(businessId, actorId) {
      return [...heldSales.values()].filter(
        (h) => h.businessId === businessId && h.actorId === actorId,
      );
    },
    async markHeldResumed(id, businessId) {
      const h = heldSales.get(id);
      if (h && h.businessId === businessId) heldSales.set(id, { ...h, resumedAt: new Date() });
    },
    async claimIdempotency(r) {
      // Encode the three distinct unique-key fields without delimiter collisions.
      // This mirrors the (businessId, key, commandType) SQL uniqueness contract.
      const key = JSON.stringify([r.businessId, r.key, r.commandType]);
      if (idempotency.has(key)) throw new Error("IDEMPOTENCY_REPLAY");
      idempotency.set(key, r);
    },
    async findIdempotency(businessId, key, commandType) {
      return idempotency.get(JSON.stringify([businessId, key, commandType])) ?? null;
    },
    async nextReceiptNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (purchaseReceiptSeq.get(businessId) ?? 0) + 1;
      purchaseReceiptSeq.set(businessId, seq);
      return `${year}-${String(seq).padStart(6, "0")}`;
    },
    async createRegister(r) {
      const row = { ...r, id: nid("reg") };
      registers.set(row.id, row);
      return row;
    },
    async listRegisters(businessId) {
      return [...registers.values()].filter((r) => r.businessId === businessId);
    },
    async findRegisterById(id, businessId) {
      const r = registers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      return r;
    },
    async updateRegister(id, businessId, patch) {
      const r = registers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      const next = { ...r, ...patch };
      registers.set(id, next);
      return next;
    },
    async createShift(s) {
      const row = { ...s, id: nid("shift") };
      shifts.set(row.id, row);
      return row;
    },
    async findShiftById(id, businessId) {
      const s = shifts.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      return s;
    },
    async findOpenShiftByRegister(businessId, registerId) {
      for (const s of shifts.values()) {
        if (s.businessId === businessId && s.registerId === registerId && s.status === "OPEN") return s;
      }
      return null;
    },
    async listShiftsByBusiness(businessId) {
      return [...shifts.values()].filter((s) => s.businessId === businessId);
    },
    async updateShift(id, businessId, patch) {
      const s = shifts.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch };
      shifts.set(id, next);
      return next;
    },
    async createCashMovement(m) {
      const row = { ...m, id: nid("cmov") };
      cashMovements.set(row.id, row);
      return row;
    },
    async listCashMovementsByShift(shiftId, businessId) {
      return [...cashMovements.values()].filter(
        (m) => m.shiftId === shiftId && m.businessId === businessId,
      );
    },
    async createCustomer(c) {
      const row = { ...c, id: nid("cust") };
      customers.set(row.id, row);
      return row;
    },
    async listCustomersByBusiness(businessId) {
      return [...customers.values()].filter((c) => c.businessId === businessId);
    },
    async findCustomerById(id, businessId) {
      const c = customers.get(id) ?? null;
      if (!c || c.businessId !== businessId) return null;
      return c;
    },
    async updateCustomer(id, businessId, patch) {
      const c = customers.get(id) ?? null;
      if (!c || c.businessId !== businessId) return null;
      const next = { ...c, ...patch };
      customers.set(id, next);
      return next;
    },
    async createGiftCard(c) {
      if ([...giftCards.values()].some((row) => row.businessId === c.businessId && row.codeHash === c.codeHash)) throw new Error("GIFT_CARD_DUPLICATE");
      const now = new Date();
      const row: DbGiftCard = { ...c, id: nid("gcard"), createdAt: now, updatedAt: now };
      giftCards.set(row.id, row);
      return row;
    },
    async findGiftCardByHash(codeHash, businessId) {
      return [...giftCards.values()].find((row) => row.businessId === businessId && row.codeHash === codeHash) ?? null;
    },
    async findGiftCardById(id, businessId) {
      const row = giftCards.get(id) ?? null;
      return row && row.businessId === businessId ? row : null;
    },
    async listGiftCards(businessId) {
      return [...giftCards.values()].filter((row) => row.businessId === businessId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async updateGiftCard(id, businessId, patch) {
      const row = giftCards.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      const next = { ...row, ...patch, updatedAt: new Date() };
      giftCards.set(id, next);
      return next;
    },
    async createGiftCardTransaction(t) {
      const existing = [...giftCardTransactions.values()].find((row) => row.businessId === t.businessId && row.idempotencyKey === t.idempotencyKey);
      if (existing) return existing;
      const card = giftCards.get(t.giftCardId);
      if (!card || card.businessId !== t.businessId) throw new Error("NOT_FOUND");
      const balance = [...giftCardTransactions.values()].filter((row) => row.businessId === t.businessId && row.giftCardId === t.giftCardId).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      if (balance + t.amountDeltaMinor < 0) throw new Error("GIFT_CARD_INSUFFICIENT_BALANCE");
      const row: DbGiftCardTransaction = { ...t, id: nid("gct"), createdAt: new Date() };
      giftCardTransactions.set(row.id, row);
      if (balance + t.amountDeltaMinor === 0 && card.status === "ACTIVE") await this.updateGiftCard(card.id, card.businessId, { status: "EXHAUSTED" });
      if (balance + t.amountDeltaMinor > 0 && card.status === "EXHAUSTED") await this.updateGiftCard(card.id, card.businessId, { status: "ACTIVE" });
      return row;
    },
    async listGiftCardTransactions(giftCardId, businessId) {
      return [...giftCardTransactions.values()].filter((row) => row.giftCardId === giftCardId && row.businessId === businessId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async findGiftCardTransactionByIdempotency(businessId, idempotencyKey) {
      return [...giftCardTransactions.values()].find((row) => row.businessId === businessId && row.idempotencyKey === idempotencyKey) ?? null;
    },
    async createStoreCreditAccount(a) {
      const existing = [...storeCreditAccounts.values()].find((row) => row.businessId === a.businessId && row.customerId === a.customerId);
      if (existing) return existing;
      const row: DbStoreCreditAccount = { ...a, id: nid("sca"), createdAt: new Date(), updatedAt: new Date() };
      storeCreditAccounts.set(row.id, row);
      return row;
    },
    async findStoreCreditAccount(customerId, businessId) {
      return [...storeCreditAccounts.values()].find((row) => row.businessId === businessId && row.customerId === customerId) ?? null;
    },
    async createStoreCreditTransaction(t) {
      const existing = [...storeCreditTransactions.values()].find((row) => row.businessId === t.businessId && row.idempotencyKey === t.idempotencyKey);
      if (existing) return existing;
      const account = storeCreditAccounts.get(t.accountId);
      if (!account || account.businessId !== t.businessId || account.customerId !== t.customerId) throw new Error("NOT_FOUND");
      const balance = [...storeCreditTransactions.values()].filter((row) => row.businessId === t.businessId && row.accountId === t.accountId).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      if (balance + t.amountDeltaMinor < 0) throw new Error("STORE_CREDIT_INSUFFICIENT_BALANCE");
      const row: DbStoreCreditTransaction = { ...t, id: nid("sct"), createdAt: new Date() };
      storeCreditTransactions.set(row.id, row);
      return row;
    },
    async listStoreCreditTransactions(accountId, businessId) {
      return [...storeCreditTransactions.values()].filter((row) => row.accountId === accountId && row.businessId === businessId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async findStoreCreditTransactionByIdempotency(businessId, idempotencyKey) {
      return [...storeCreditTransactions.values()].find((row) => row.businessId === businessId && row.idempotencyKey === idempotencyKey) ?? null;
    },
    async upsertLoyaltyProgram(p) {
      const existing = loyaltyPrograms.get(p.businessId);
      const row: DbLoyaltyProgram = existing ? { ...existing, ...p, version: existing.version + 1, updatedAt: new Date() } : { ...p, id: nid("lp"), updatedAt: new Date() };
      loyaltyPrograms.set(p.businessId, row);
      return row;
    },
    async getLoyaltyProgram(businessId) { return loyaltyPrograms.get(businessId) ?? null; },
    async createLoyaltyAccount(a) {
      const existing = [...loyaltyAccounts.values()].find((row) => row.businessId === a.businessId && row.customerId === a.customerId);
      if (existing) return existing;
      const row: DbLoyaltyAccount = { ...a, id: nid("la"), createdAt: new Date(), updatedAt: new Date() };
      loyaltyAccounts.set(row.id, row);
      return row;
    },
    async findLoyaltyAccount(customerId, businessId) { return [...loyaltyAccounts.values()].find((row) => row.businessId === businessId && row.customerId === customerId) ?? null; },
    async createLoyaltyTransaction(t) {
      const existing = [...loyaltyTransactions.values()].find((row) => row.businessId === t.businessId && row.idempotencyKey === t.idempotencyKey);
      if (existing) return existing;
      const account = loyaltyAccounts.get(t.accountId);
      if (!account || account.businessId !== t.businessId || account.customerId !== t.customerId) throw new Error("NOT_FOUND");
      const balance = [...loyaltyTransactions.values()].filter((row) => row.businessId === t.businessId && row.accountId === t.accountId).reduce((sum, row) => sum + row.pointsDelta, 0);
      if (balance + t.pointsDelta < 0 && !t.type.startsWith("REFUND_EARN")) throw new Error("LOYALTY_INSUFFICIENT_POINTS");
      const row: DbLoyaltyTransaction = { ...t, id: nid("lt"), createdAt: new Date() };
      loyaltyTransactions.set(row.id, row);
      return row;
    },
    async listLoyaltyTransactions(accountId, businessId) { return [...loyaltyTransactions.values()].filter((row) => row.accountId === accountId && row.businessId === businessId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); },
    async findLoyaltyTransactionByIdempotency(businessId, idempotencyKey) { return [...loyaltyTransactions.values()].find((row) => row.businessId === businessId && row.idempotencyKey === idempotencyKey) ?? null; },
    async createSaleGiftCardLoad(l) { const row: DbSaleGiftCardLoad = { ...l, id: nid("sgl"), createdAt: new Date() }; saleGiftCardLoads.set(row.id, row); return row; },
    async updateSaleGiftCardLoad(id, businessId, patch) { const row = saleGiftCardLoads.get(id); if (!row || row.businessId !== businessId) return null; const updated = { ...row, ...patch }; saleGiftCardLoads.set(id, updated); return updated; },
    async listSaleGiftCardLoads(saleId, businessId) { return [...saleGiftCardLoads.values()].filter((row) => row.saleId === saleId && row.businessId === businessId); },
    async createSaleLoyalty(s) { const row: DbSaleLoyalty = { ...s, id: nid("sl"), createdAt: new Date() }; saleLoyalty.set(row.saleId, row); return row; },
    async findSaleLoyalty(saleId, businessId) { const row = saleLoyalty.get(saleId) ?? null; return row && row.businessId === businessId ? row : null; },
    async updateSaleLoyalty(id, businessId, patch) { const row = saleLoyalty.get(id); if (!row || row.businessId !== businessId) return null; const updated = { ...row, ...patch }; saleLoyalty.set(id, updated); return updated; },
    async createSaleItemLoyaltyAllocation(a) { const row: DbSaleItemLoyaltyAllocation = { ...a, id: nid("sla"), createdAt: new Date() }; saleItemLoyaltyAllocations.set(row.id, row); return row; },
    async listSaleItemLoyaltyAllocations(saleLoyaltyId, businessId) { return [...saleItemLoyaltyAllocations.values()].filter((row) => row.saleLoyaltyId === saleLoyaltyId && row.businessId === businessId); },
    async createRefund(r) {
      const row: DbRefund = { deliveryFeeRefundMinor: 0, deliveryTaxRefundMinor: 0, ...r, id: nid("ref") };
      refunds.set(row.id, row);
      return row;
    },
    async createCustomerConcern(c: DbCustomerConcernCreate) {
      if ([...customerConcerns.values()].some((row) => row.businessId === c.businessId && row.idempotencyKey === c.idempotencyKey)) {
        throw new Error("IDEMPOTENCY_MISMATCH");
      }
      const now = new Date();
      const row: DbCustomerConcern = { ...c, reviewedAt: c.reviewedAt ?? null, items: c.items.map((item) => ({ ...item })), id: nid("concern"), createdAt: now, updatedAt: now };
      customerConcerns.set(row.id, row);
      return row;
    },
    async findCustomerConcernById(id, businessId) {
      const row = customerConcerns.get(id) ?? null;
      return row?.businessId === businessId ? row : null;
    },
    async findCustomerConcernByIdempotency(businessId, idempotencyKey) {
      return [...customerConcerns.values()].find((row) => row.businessId === businessId && row.idempotencyKey === idempotencyKey) ?? null;
    },
    async listCustomerConcernsByBusiness(businessId) {
      return [...customerConcerns.values()].filter((row) => row.businessId === businessId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    },
    async transitionCustomerConcern(id, businessId, expectedStatus, patch) {
      const row = customerConcerns.get(id);
      if (!row || row.businessId !== businessId || row.status !== expectedStatus) return null;
      const updated: DbCustomerConcern = { ...row, ...patch, updatedAt: new Date() };
      customerConcerns.set(id, updated);
      return updated;
    },
    async createManagerApprovalRequest(input: DbManagerApprovalRequestCreate) {
      if ([...managerApprovalRequests.values()].some((row) => row.businessId === input.businessId && row.requesterId === input.requesterId && row.idempotencyKey === input.idempotencyKey)) throw new Error("IDEMPOTENCY_MISMATCH");
      const now = new Date();
      const row: DbManagerApprovalRequest = { ...input, action: { ...input.action }, id: nid("approval"), createdAt: now, updatedAt: now };
      managerApprovalRequests.set(row.id, row);
      return row;
    },
    async findManagerApprovalRequest(id, businessId) {
      const row = managerApprovalRequests.get(id) ?? null;
      return row?.businessId === businessId ? row : null;
    },
    async findManagerApprovalRequestByIdempotency(businessId, requesterId, idempotencyKey) {
      return [...managerApprovalRequests.values()].find((row) => row.businessId === businessId && row.requesterId === requesterId && row.idempotencyKey === idempotencyKey) ?? null;
    },
    async listManagerApprovalRequests(businessId) {
      return [...managerApprovalRequests.values()].filter((row) => row.businessId === businessId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    },
    async transitionManagerApprovalRequest(id, businessId, expectedStatus, patch) {
      const row = managerApprovalRequests.get(id);
      if (!row || row.businessId !== businessId || row.status !== expectedStatus) return null;
      const updated: DbManagerApprovalRequest = { ...row, ...patch, updatedAt: new Date() };
      managerApprovalRequests.set(id, updated);
      return updated;
    },
    async claimManagerApprovalRequestToken(id, businessId, requesterId, now) {
      const row = managerApprovalRequests.get(id);
      if (!row || row.businessId !== businessId || row.requesterId !== requesterId || row.status !== "APPROVED" || row.tokenClaimedAt || !row.tokenCiphertext || !row.tokenExpiresAt || row.tokenExpiresAt <= now) return null;
      const encryptedToken = row.tokenCiphertext;
      const request: DbManagerApprovalRequest = { ...row, tokenCiphertext: null, tokenExpiresAt: null, tokenClaimedAt: now, updatedAt: now };
      managerApprovalRequests.set(id, request);
      return { request, encryptedToken, tokenExpiresAt: row.tokenExpiresAt };
    },
    async listRefundsByBusiness(businessId) {
      return [...refunds.values()].filter((r) => r.businessId === businessId);
    },
    async listRefundsBySale(saleId, businessId) {
      return [...refunds.values()].filter(
        (r) => r.saleId === saleId && r.businessId === businessId,
      );
    },
    async findRefundById(id, businessId) {
      const r = refunds.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      return r;
    },
    async createRefundItem(i) {
      const row = { ...i, id: nid("ritem") };
      refundItems.set(row.id, row);
      return row;
    },
    async listRefundItems(refundId, businessId) {
      return [...refundItems.values()].filter(
        (i) => i.refundId === refundId && i.businessId === businessId,
      );
    },
    async listRefundItemsBySale(saleId, businessId) {
      const ids = new Set(
        [...refunds.values()]
          .filter((r) => r.saleId === saleId && r.businessId === businessId)
          .map((r) => r.id),
      );
      return [...refundItems.values()].filter(
        (i) => ids.has(i.refundId) && i.businessId === businessId,
      );
    },
    async listRefundItemsByBusiness(businessId) {
      return [...refundItems.values()].filter((i) => i.businessId === businessId);
    },
    async createExchange(e) {
      const row = { ...e, id: nid("exch"), createdAt: new Date() };
      exchanges.set(row.id, row);
      return row;
    },
    async findExchangeById(id, businessId) {
      const row = exchanges.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      return row;
    },
    async listExchangesByOriginalSale(originalSaleId, businessId) {
      return [...exchanges.values()]
        .filter((row) => row.businessId === businessId && row.originalSaleId === originalSaleId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async findExchangeByReplacementSale(replacementSaleId, businessId) {
      return [...exchanges.values()].find(
        (row) => row.businessId === businessId && row.replacementSaleId === replacementSaleId,
      ) ?? null;
    },
    async createExpense(e) {
      const row = { ...e, id: nid("exp") };
      expenses.set(row.id, row);
      return row;
    },
    async listExpensesByBusiness(businessId) {
      return [...expenses.values()].filter((e) => e.businessId === businessId);
    },
    async listExpensesPage(businessId, afterId, limit) {
      const rows = [...expenses.values()]
        .filter((e) => e.businessId === businessId && (afterId === null || e.id > afterId))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.slice(0, limit);
    },
    async findExpenseById(id, businessId) {
      const e = expenses.get(id) ?? null;
      if (!e || e.businessId !== businessId) return null;
      return e;
    },
    async updateExpense(id, businessId, patch) {
      const e = expenses.get(id) ?? null;
      if (!e || e.businessId !== businessId) return null;
      const next = { ...e, ...patch };
      expenses.set(id, next);
      return next;
    },
    async createBranch(b) {
      const row = { ...b, id: nid("br") };
      branches.set(row.id, row);
      return row;
    },
    async listBranchesByBusiness(businessId) {
      return [...branches.values()]
        .filter((b) => b.businessId === businessId)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async findBranchById(id, businessId) {
      const b = branches.get(id) ?? null;
      if (!b || b.businessId !== businessId) return null;
      return b;
    },
    async updateBranch(id, businessId, patch) {
      const b = branches.get(id) ?? null;
      if (!b || b.businessId !== businessId) return null;
      const next = { ...b, ...patch };
      branches.set(id, next);
      return next;
    },
    async createTransfer(t) {
      const row = { ...t, id: nid("trx") };
      transfers.set(row.id, row);
      return row;
    },
    async findTransferById(id, businessId) {
      const t = transfers.get(id) ?? null;
      if (!t || t.businessId !== businessId) return null;
      return t;
    },
    async listTransfersByBusiness(businessId) {
      return [...transfers.values()].filter((t) => t.businessId === businessId);
    },
    async updateTransfer(id, businessId, patch) {
      const t = transfers.get(id) ?? null;
      if (!t || t.businessId !== businessId) return null;
      const next = { ...t, ...patch };
      transfers.set(id, next);
      return next;
    },
    async createTransferLine(l) {
      const row = { ...l, id: nid("tline") };
      transferLines.set(row.id, row);
      return row;
    },
    async listTransferLines(transferId, businessId) {
      return [...transferLines.values()].filter(
        (l) => l.transferId === transferId && l.businessId === businessId,
      );
    },
    async createDevice(d) {
      const row = { ...d, id: nid("dev") };
      devices.set(row.id, row);
      return row;
    },
    async listDevicesByBusiness(businessId) {
      return [...devices.values()].filter((d) => d.businessId === businessId);
    },
    async findDeviceById(id, businessId) {
      const d = devices.get(id) ?? null;
      if (!d || d.businessId !== businessId) return null;
      return d;
    },
    async revokeDevice(id, businessId, revokedAt) {
      const d = devices.get(id) ?? null;
      if (!d || d.businessId !== businessId) return null;
      const next = { ...d, revokedAt };
      devices.set(id, next);
      return next;
    },
    async revokeSessionsByDevice(businessId, deviceId) {
      for (const s of sessions.values()) {
        if (s.businessId === businessId && s.deviceId === deviceId && s.revokedAt === null) {
          sessions.set(s.id, { ...s, revokedAt: new Date() });
        }
      }
    },
    async listPlans() {
      return [...plans.values()];
    },
    async findPlanByKey(key) {
      for (const p of plans.values()) if (p.key === key) return p;
      return null;
    },
    async getSubscription(businessId) {
      for (const s of subscriptions.values()) if (s.businessId === businessId) return s;
      return null;
    },
    async upsertSubscription(s) {
      let existing = null;
      for (const cur of subscriptions.values()) {
        if (cur.businessId === s.businessId) { existing = cur; break; }
      }
      const row = existing
        ? { ...existing, ...s, id: existing.id, providerRef: s.providerRef ?? existing.providerRef }
        : { ...s, id: nid("sub"), providerRef: s.providerRef ?? null };
      subscriptions.set(row.id, row);
      return row;
    },
    async updateSubscription(id, businessId, patch) {
      const s = subscriptions.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch };
      subscriptions.set(id, next);
      return next;
    },
    async listInvoices(businessId) {
      return [...invoices.values()].filter((i) => i.businessId === businessId);
    },
    async createInvoice(i) {
      const row = { ...i, id: nid("inv"), issuedAt: new Date() };
      invoices.set(row.id, row);
      return row;
    },
    async updateInvoice(id, businessId, patch) {
      const i = invoices.get(id) ?? null;
      if (!i || i.businessId !== businessId) return null;
      const next = { ...i, ...patch };
      invoices.set(id, next);
      return next;
    },
    async listCounters(businessId) {
      return [...counters.values()].filter((c) => c.businessId === businessId);
    },
    async setCounter(businessId, key, period, count) {
      const id = `${businessId}:${key}:${period}`;
      const row = { id, businessId, key, period, count };
      counters.set(id, row);
      return row;
    },
    async getFlag(businessId, key) {
      for (const f of flags.values()) {
        if ((f.businessId ?? null) === (businessId ?? null) && f.key === key) return f;
      }
      return null;
    },
    async setFlag(f) {
      const { businessId, key, enabled } = f;
      let existing = null;
      for (const cur of flags.values()) {
        if ((cur.businessId ?? null) === (businessId ?? null) && cur.key === key) { existing = cur; break; }
      }
      const row = existing ? { ...existing, enabled } : { id: nid("flag"), businessId, key, enabled };
      flags.set(row.id, row);
      return row;
    },
    async findWebhookEvent(provider, eventId) {
      for (const e of webhookEvents.values()) {
        if (e.provider === provider && e.eventId === eventId) return e;
      }
      return null;
    },
    async createWebhookEvent(e) {
      const row = { ...e, id: nid("whev"), receivedAt: new Date() };
      webhookEvents.set(row.id, row);
      return row;
    },
    async claimWebhookEvent(e) {
      for (const existing of webhookEvents.values()) {
        if (existing.provider === e.provider && existing.eventId === e.eventId) return null;
      }
      const row = { ...e, id: nid("whev"), receivedAt: new Date() };
      webhookEvents.set(row.id, row);
      return row;
    },
    async updateWebhookEventStatus(id, status) {
      const row = webhookEvents.get(id);
      if (row) webhookEvents.set(id, { ...row, status });
    },
    async updateWebhookEventReceivedAt(id, receivedAt) {
      const row = webhookEvents.get(id);
      if (row) webhookEvents.set(id, { ...row, receivedAt });
    },
    async deleteWebhookEvent(id) {
      webhookEvents.delete(id);
    },
    async createApiToken(t) {
      const row = { ...t, id: nid("tok") };
      apiTokens.set(row.id, row);
      return row;
    },
    async listApiTokens(businessId) {
      return [...apiTokens.values()].filter((t) => t.businessId === businessId);
    },
    async findApiTokenByPrefix(prefix) {
      for (const t of apiTokens.values()) if (t.prefix === prefix) return t;
      return null;
    },
    async listApiTokensByPrefix(prefix) {
      return [...apiTokens.values()].filter((t) => t.prefix === prefix);
    },
    async revokeApiToken(id, businessId, revokedAt) {
      const t = apiTokens.get(id) ?? null;
      if (!t || t.businessId !== businessId) return null;
      const next = { ...t, revokedAt };
      apiTokens.set(id, next);
      return next;
    },
    async createPrinter(p) {
      const row = { ...p, id: nid("prt") };
      printers.set(row.id, row);
      return row;
    },
    async listPrinters(businessId) {
      return [...printers.values()].filter((p) => p.businessId === businessId);
    },
    async findPrinterById(id, businessId) {
      const p = printers.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      return p;
    },
    async findPrinterByAgentTokenHash(tokenHash) {
      for (const p of printers.values()) {
        if (p.agentTokenHash !== null && p.agentTokenHash === tokenHash) return p;
      }
      return null;
    },
    async updatePrinter(id, businessId, patch) {
      const p = printers.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      const next = { ...p, ...patch };
      printers.set(id, next);
      return next;
    },
    async createPrintJob(j) {
      const row = { ...j, id: nid("pjob") };
      printJobs.set(row.id, row);
      return row;
    },
    async findPrintJobById(id, businessId) {
      const job = printJobs.get(id) ?? null;
      if (!job || job.businessId !== businessId) return null;
      return job;
    },
    async listPrintJobs(businessId, status) {
      return [...printJobs.values()].filter(
        (j) => j.businessId === businessId && (status === undefined || j.status === status),
      );
    },
    async updatePrintJob(id, businessId, patch, expectedStatus) {
      const j = printJobs.get(id) ?? null;
      if (!j || j.businessId !== businessId) return null;
      if (expectedStatus !== undefined && j.status !== expectedStatus) return null;
      const next = { ...j, ...patch };
      printJobs.set(id, next);
      return next;
    },
    async createDisplayToken(t) {
      const row = { ...t, id: nid("dtok") };
      displayTokens.set(row.id, row);
      return row;
    },
    async findDisplayToken(tokenHash) {
      for (const t of displayTokens.values()) if (t.tokenHash === tokenHash) return t;
      return null;
    },

    // Phase 16: procurement. Commercial records only — these stores never
    // touch movements/balances, mirroring the service-level invariant.
    async createSupplier(s) {
      const now = new Date();
      const row = { ...s, id: nid("spr"), createdAt: now, updatedAt: now };
      suppliers.set(row.id, row);
      return row;
    },
    async listSuppliersByBusiness(businessId) {
      return [...suppliers.values()].filter((s) => s.businessId === businessId);
    },
    async findSupplierById(id, businessId) {
      const s = suppliers.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      return s;
    },
    async updateSupplier(id, businessId, patch) {
      const s = suppliers.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch, updatedAt: new Date() };
      suppliers.set(id, next);
      return next;
    },

    async createProductSupplier(r) {
      const now = new Date();
      const row = { ...r, id: nid("psup"), createdAt: now, updatedAt: now };
      productSuppliers.set(row.id, row);
      return row;
    },
    async listProductSuppliersBySupplier(supplierId, businessId) {
      return [...productSuppliers.values()].filter(
        (r) => r.supplierId === supplierId && r.businessId === businessId,
      );
    },
    async listProductSuppliersByBusiness(businessId) {
      return [...productSuppliers.values()].filter((r) => r.businessId === businessId);
    },
    async findProductSupplierById(id, businessId) {
      const r = productSuppliers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      return r;
    },
    async updateProductSupplier(id, businessId, patch) {
      const r = productSuppliers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      const next = { ...r, ...patch, updatedAt: new Date() };
      productSuppliers.set(id, next);
      return next;
    },
    async clearPreferredProductSuppliers(businessId, productId, exceptId) {
      for (const [id, r] of productSuppliers) {
        if (r.businessId === businessId && r.productId === productId && r.isPreferred && id !== exceptId) {
          productSuppliers.set(id, { ...r, isPreferred: false, updatedAt: new Date() });
        }
      }
    },
    async deleteProductSupplier(id, businessId) {
      const r = productSuppliers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return false;
      productSuppliers.delete(id);
      return true;
    },

    async createPurchaseOrder(p) {
      const now = new Date();
      const row = {
        ...p,
        id: nid("po"),
        version: p.version ?? 1,
        createdAt: now,
        updatedAt: now,
      };
      purchaseOrders.set(row.id, row);
      return row;
    },
    async findPurchaseOrderById(id, businessId) {
      const p = purchaseOrders.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      return p;
    },
    async listPurchaseOrdersByBusiness(businessId) {
      return [...purchaseOrders.values()].filter((p) => p.businessId === businessId);
    },
    async updatePurchaseOrder(id, businessId, patch, expectedVersion) {
      const p = purchaseOrders.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      // Optimistic-concurrency CAS: a stale expectedVersion never writes.
      if (p.version !== expectedVersion) return null;
      const next = { ...p, ...patch, version: expectedVersion + 1, updatedAt: new Date() };
      purchaseOrders.set(id, next);
      return next;
    },
    async nextPoNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (poSeq.get(businessId) ?? 0) + 1;
      poSeq.set(businessId, seq);
      return `PO-${year}-${String(seq).padStart(6, "0")}`;
    },

    async createPurchaseOrderLine(l) {
      const now = new Date();
      const row = {
        ...l,
        id: nid("pol"),
        createdAt: now,
        updatedAt: now,
      };
      purchaseOrderLines.set(row.id, row);
      return row;
    },
    async listPurchaseOrderLines(purchaseOrderId, businessId) {
      return [...purchaseOrderLines.values()].filter(
        (l) => l.purchaseOrderId === purchaseOrderId && l.businessId === businessId,
      );
    },
    async deletePurchaseOrderLines(purchaseOrderId, businessId) {
      for (const [id, l] of purchaseOrderLines) {
        if (l.purchaseOrderId === purchaseOrderId && l.businessId === businessId) {
          purchaseOrderLines.delete(id);
        }
      }
    },

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

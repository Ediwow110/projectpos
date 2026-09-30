import type { AuditEntry, DbApiToken, DbBalance, DbBranch, DbBusiness, DbCategory, DbDevice, DbDisplayToken, DbExchange, DbFeatureFlag, DbInvoice, DbMembership, DbMovement, DbPlan, DbPort, DbPrinter, DbPrintJob, DbProduct, DbResetToken, DbSession, DbShiftCorrection, DbStockTransfer, DbStockTransferLine, DbSubscription, DbUsageCounter, DbUser, DbSale, DbSaleItem, DbPayment, DbHeldSale, DbIdempotency, DbRegister, DbShift, DbCashMovement, DbCustomer, DbRefund, DbRefundItem, DbExpense, DbWebhookEvent } from "./db.port";

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
  const movements = new Map<string, DbMovement>();
  const balances = new Map<string, DbBalance>();
  const sales = new Map<string, DbSale>();
  const saleItems = new Map<string, DbSaleItem>();
  const payments = new Map<string, DbPayment>();
  const heldSales = new Map<string, DbHeldSale>();
  const idempotency = new Map<string, DbIdempotency>();
  const receiptSeq = new Map<string, number>();
  const registers = new Map<string, DbRegister>();
  const shifts = new Map<string, DbShift>();
  const cashMovements = new Map<string, DbCashMovement>();
  const customers = new Map<string, DbCustomer>();
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
  const audit: AuditEntry[] = [];

  const balanceKey = (businessId: string, branchId: string | null | undefined, productId: string): string =>
    `${businessId}:${branchId ?? ""}:${productId}`;

  // Phase 12: the promise-chain locks move out of the individual services
  // into the port, so the PostgreSQL implementation can swap them for
  // transaction-scoped advisory locks without touching service code.
  const locks = new Map<string, Promise<void>>();
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
      // Single-threaded in-memory writes are already atomic; the body just
      // runs against the same store.
      return fn(memoryDb);
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
      const row = { ...b, id: nid("biz") };
      businesses.set(row.id, row);
      return row;
    },
    async findBusinessById(id) {
      return businesses.get(id) ?? null;
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
      if (m && m.businessId === businessId) memberships.set(id, { ...m, deactivatedAt: patch.deactivatedAt });
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
      const row = existing ? { ...existing, qtyOnHand: b.qtyOnHand } : { ...b, id: nid("bal") };
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
    async createSale(s) {
      const row = { completedAt: null, ...s, id: nid("sale") };
      sales.set(row.id, row);
      return row;
    },
    async findSaleById(id, businessId) {
      const s = sales.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      return s;
    },
    async listSalesByBusiness(businessId) {
      return [...sales.values()].filter((s) => s.businessId === businessId);
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
    async createPayment(p) {
      const row = { ...p, id: nid("pay") };
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
      const key = `${r.businessId}:${r.key}:${r.commandType}`;
      if (idempotency.has(key)) throw new Error("IDEMPOTENCY_REPLAY");
      idempotency.set(key, r);
    },
    async findIdempotency(businessId, key, commandType) {
      return idempotency.get(`${businessId}:${key}:${commandType}`) ?? null;
    },
    async nextReceiptNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (receiptSeq.get(businessId) ?? 0) + 1;
      receiptSeq.set(businessId, seq);
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
    async createRefund(r) {
      const row = { ...r, id: nid("ref") };
      refunds.set(row.id, row);
      return row;
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
    async createPrintJob(j) {
      const row = { ...j, id: nid("pjob") };
      printJobs.set(row.id, row);
      return row;
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
  };
  return memoryDb;
}

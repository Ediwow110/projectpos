import type { AuditEntry, DbBalance, DbBranch, DbBusiness, DbCategory, DbMembership, DbMovement, DbPort, DbProduct, DbResetToken, DbSession, DbStockTransfer, DbStockTransferLine, DbUser, DbSale, DbSaleItem, DbPayment, DbHeldSale, DbIdempotency, DbRegister, DbShift, DbCashMovement, DbCustomer, DbRefund, DbRefundItem, DbExpense } from "./db.port";

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
  const expenses = new Map<string, DbExpense>();
  const branches = new Map<string, DbBranch>();
  const transfers = new Map<string, DbStockTransfer>();
  const transferLines = new Map<string, DbStockTransferLine>();
  const audit: AuditEntry[] = [];

  const balanceKey = (businessId: string, branchId: string | null | undefined, productId: string): string =>
    `${businessId}:${branchId ?? ""}:${productId}`;
  return {
    audit,
    async findUserByEmail(email) {
      for (const u of users.values()) if (u.email === email) return u;
      return null;
    },
    async findUserById(id) {
      return users.get(id) ?? null;
    },
    async createUser(u) {
      const row = { ...u, id: nid("user") };
      users.set(row.id, row);
      return row;
    },
    async updateUserPassword(id, passwordHash) {
      const u = users.get(id);
      if (u) users.set(id, { ...u, passwordHash });
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
    async createSession(s) {
      const row = { ...s, id: nid("sess") };
      sessions.set(row.id, row);
      return row;
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
    async getSettings(businessId) {
      return settings.get(businessId) ?? {};
    },
    async saveSettings(businessId, next) {
      settings.set(businessId, next);
    },
    async appendAudit(e) {
      audit.push(e);
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
      const row = { ...s, id: nid("sale") };
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
    async updateSale(id, businessId, patch) {
      const s = sales.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch };
      sales.set(id, next);
      return next;
    },
    async createSaleItem(i) {
      const row = { ...i, id: nid("sitem") };
      saleItems.set(row.id, row);
      return row;
    },
    async listSaleItems(saleId, businessId) {
      return [...saleItems.values()].filter(
        (i) => i.saleId === saleId && i.businessId === businessId,
      );
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
    async createExpense(e) {
      const row = { ...e, id: nid("exp") };
      expenses.set(row.id, row);
      return row;
    },
    async listExpensesByBusiness(businessId) {
      return [...expenses.values()].filter((e) => e.businessId === businessId);
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
  };
}

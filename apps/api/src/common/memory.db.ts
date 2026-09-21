import type { AuditEntry, DbBalance, DbBusiness, DbCategory, DbMembership, DbMovement, DbPort, DbProduct, DbResetToken, DbSession, DbUser } from "./db.port";

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
  const audit: AuditEntry[] = [];
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
    async listMovements(productId, businessId) {
      return [...movements.values()].filter(
        (m) => m.productId === productId && m.businessId === businessId,
      );
    },
    async listMovementsByBusiness(businessId) {
      return [...movements.values()].filter((m) => m.businessId === businessId);
    },
    async upsertBalance(b) {
      const key = `${b.businessId}:${b.productId}`;
      const existing = balances.get(key);
      const row = existing ? { ...existing, qtyOnHand: b.qtyOnHand } : { ...b, id: nid("bal") };
      balances.set(key, row);
      return row;
    },
    async findBalance(productId, businessId) {
      const row = balances.get(`${businessId}:${productId}`) ?? null;
      if (!row || row.businessId !== businessId) return null;
      return row;
    },
    async listBalances(businessId) {
      return [...balances.values()].filter((b) => b.businessId === businessId);
    },
  };
}

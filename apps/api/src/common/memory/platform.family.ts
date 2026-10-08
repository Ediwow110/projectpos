import type {
  DbPort,
  DbReceiptDelivery,
} from "../db.port";
import type { MemoryState } from "./context";

export function createMemoryPlatform(context: MemoryState): Pick<DbPort, "createUser" | "updateUserPassword" | "setUserEmailVerified" | "setUserWorkspaceTourSeen" | "createBusiness" | "findBusinessById" | "listMembershipsByUser" | "listMembershipsByBusiness" | "findLatestSaleForRegister" | "hasShiftForRegister" | "findMembership" | "createMembership" | "updateMembership" | "createSession" | "updateSession" | "findSessionByTokenHash" | "listSessionsByUser" | "revokeSession" | "revokeAllUserSessions" | "saveResetToken" | "findResetToken" | "markResetTokenUsed" | "createEmailVerificationToken" | "findEmailVerificationToken" | "markEmailVerificationTokenUsed" | "createSupportGrant" | "findValidSupportGrant" | "markSupportGrantUsed" | "createManagerApprovalGrant" | "findValidManagerApprovalGrant" | "markManagerApprovalGrantUsed" | "createShiftCorrection" | "listShiftCorrections" | "createReceiptShare" | "findValidReceiptShare" | "claimReceiptDelivery" | "updateReceiptDelivery" | "listReceiptDeliveries" | "getSettings" | "saveSettings" | "appendAudit" | "listAudit"> {
  const {
    users,
    businesses,
    memberships,
    sessions,
    resets,
    settings,
    sales,
    shifts,
    emailVerifications,
    supportGrants,
    managerApprovalGrants,
    shiftCorrections,
    receiptShares,
    receiptDeliveries,
    audit,
    nextId: nid,
  } = context;

  return {
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
  };
}

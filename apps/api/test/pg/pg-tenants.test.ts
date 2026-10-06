import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";
import type { DbPort } from "../../src/common/db.port";

// Tenants-family parity tests: mirror the memory store's behavior (same
// filters, same sort orders, same null/empty returns) against PgDbPort.
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seedUser(db: DbPort, email?: string) {
  return db.createUser({
    name: "Tester",
    email: email ?? uniq("u"),
    passwordHash: "hash-old",
    emailVerified: true,
  });
}

async function seedBusiness(db: DbPort, name?: string) {
  return db.createBusiness({ name: name ?? uniq("Biz"), currency: "PHP" });
}

describe("phase12 pg tenants: users", () => {
  it("creates a user and finds it by email and id", async () => {
    await withPg(async (db) => {
      const email = uniq("u");
      const created = await db.createUser({ name: "Ana", email, passwordHash: "h1", emailVerified: false });
      expect(created.id).toBeTruthy();
      const byEmail = await db.findUserByEmail(email);
      expect(byEmail).toEqual({
        id: created.id,
        name: "Ana",
        email,
        passwordHash: "h1",
        emailVerified: false,
        workspaceTourSeen: false,
      });
      const byId = await db.findUserById(created.id);
      expect(byId).toEqual(byEmail);
    });
  });

  it("defaults emailVerified to verified when omitted", async () => {
    await withPg(async (db) => {
      const created = await db.createUser({ name: "Legacy", email: uniq("u"), passwordHash: "h" });
      // undefined/true = verified (Phase 11 semantics); the DDL default is true.
      expect((await db.findUserById(created.id))!.emailVerified).toBe(true);
    });
  });

  it("returns null for missing users", async () => {
    await withPg(async (db) => {
      expect(await db.findUserByEmail(uniq("missing"))).toBeNull();
      expect(await db.findUserById("user_none")).toBeNull();
    });
  });

  it("updates the password and email-verified flag", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      await db.updateUserPassword(u.id, "hash-new");
      await db.setUserEmailVerified(u.id, false);
      const after = (await db.findUserById(u.id))!;
      expect(after.passwordHash).toBe("hash-new");
      expect(after.emailVerified).toBe(false);
    });
  });

  it("persists the per-user workspace-tour preference", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      expect((await db.findUserById(u.id))!.workspaceTourSeen).toBe(false);
      await db.setUserWorkspaceTourSeen(u.id, true);
      expect((await db.findUserById(u.id))!.workspaceTourSeen).toBe(true);
    });
  });
});

describe("phase12 pg tenants: businesses", () => {
  it("creates a business and finds it by id", async () => {
    await withPg(async (db) => {
      const b = await seedBusiness(db, "PG Store");
      expect(await db.findBusinessById(b.id)).toEqual({
        id: b.id,
        name: "PG Store",
        currency: "PHP",
        storefrontKey: null,
      });
    });
  });

  it("returns null for a missing business", async () => {
    await withPg(async (db) => {
      expect(await db.findBusinessById("biz_none")).toBeNull();
    });
  });
});

describe("phase12 pg tenants: memberships", () => {
  it("creates a membership and reads the role string back", async () => {
    await withPg(async (db, ctx) => {
      const u = await seedUser(db);
      const b = await seedBusiness(db);
      const m = await db.createMembership({ businessId: b.id, userId: u.id, role: "cashier", deactivatedAt: null });
      expect(m.id).toBeTruthy();
      expect(await db.findMembership(u.id, b.id)).toEqual({
        id: m.id, businessId: b.id, userId: u.id, role: "cashier", deactivatedAt: null, approvalPinHash: null,
      });
      // A second member with the same role upserts one Role row, not two.
      const u2 = await seedUser(db);
      await db.createMembership({ businessId: b.id, userId: u2.id, role: "cashier", deactivatedAt: null });
      const c = await ctx.client();
      try {
        const roles = await c.query('SELECT COUNT(*)::int AS n FROM "Role" WHERE "businessId" = $1 AND "name" = $2', [b.id, "cashier"]);
        expect(roles.rows[0].n).toBe(1);
      } finally {
        c.release();
      }
    });
  });

  it("findMembership returns null for a non-member", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const b = await seedBusiness(db);
      expect(await db.findMembership(u.id, b.id)).toBeNull();
    });
  });

  it("deactivates via updateMembership and ignores a mismatched businessId", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const b1 = await seedBusiness(db);
      const b2 = await seedBusiness(db);
      const m = await db.createMembership({ businessId: b1.id, userId: u.id, role: "owner", deactivatedAt: null });
      // Wrong businessId: ignored, exactly like memory.
      await db.updateMembership(m.id, b2.id, { deactivatedAt: new Date() });
      expect((await db.findMembership(u.id, b1.id))!.deactivatedAt).toBeNull();
      const at = new Date();
      await db.updateMembership(m.id, b1.id, { deactivatedAt: at });
      expect((await db.findMembership(u.id, b1.id))!.deactivatedAt).toEqual(at);
    });
  });

  it("stores a business-scoped approval PIN hash without affecting deactivation state", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const b1 = await seedBusiness(db);
      const b2 = await seedBusiness(db);
      const m = await db.createMembership({ businessId: b1.id, userId: u.id, role: "manager", deactivatedAt: null });
      await db.updateMembership(m.id, b2.id, { approvalPinHash: "wrong-tenant-hash" });
      expect((await db.findMembership(u.id, b1.id))!.approvalPinHash).toBeNull();
      await db.updateMembership(m.id, b1.id, { approvalPinHash: "argon2-pin-hash" });
      const stored = (await db.findMembership(u.id, b1.id))!;
      expect(stored.approvalPinHash).toBe("argon2-pin-hash");
      expect(stored.deactivatedAt).toBeNull();
    });
  });

  it("lists memberships by user and by business in insertion order", async () => {
    await withPg(async (db) => {
      const u1 = await seedUser(db);
      const u2 = await seedUser(db);
      const b1 = await seedBusiness(db);
      const b2 = await seedBusiness(db);
      const m1 = await db.createMembership({ businessId: b1.id, userId: u1.id, role: "owner", deactivatedAt: null });
      const m2 = await db.createMembership({ businessId: b2.id, userId: u1.id, role: "cashier", deactivatedAt: null });
      await db.createMembership({ businessId: b1.id, userId: u2.id, role: "cashier", deactivatedAt: null });
      const byUser = await db.listMembershipsByUser(u1.id);
      expect(byUser.map((m) => m.id)).toEqual([m1.id, m2.id]);
      const byBusiness = await db.listMembershipsByBusiness(b1.id);
      expect(byBusiness.map((m) => m.userId)).toEqual([u1.id, u2.id]);
      expect(byBusiness.every((m) => m.role === "owner" || m.role === "cashier")).toBe(true);
    });
  });
});

describe("phase12 pg tenants: sessions", () => {
  it("creates a session and finds it by token hash", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const b = await seedBusiness(db);
      const expiresAt = new Date(Date.now() + 60_000);
      const authenticatedAt = new Date(Date.now() - 5_000);
      const s = await db.createSession({
        userId: u.id, businessId: b.id, activeBusinessId: null, activeBranchId: null, tokenHash: "tok-1",
        expiresAt, revokedAt: null, authenticatedAt, ip: "127.0.0.1", userAgent: "vitest", deviceId: null,
      });
      expect(s.id).toBeTruthy();
      expect(await db.findSessionByTokenHash("tok-1")).toEqual({
        id: s.id, userId: u.id, businessId: b.id, activeBusinessId: null, activeBranchId: null, tokenHash: "tok-1",
        expiresAt, revokedAt: null, authenticatedAt, ip: "127.0.0.1", userAgent: "vitest", deviceId: null,
      });
      expect(await db.findSessionByTokenHash("tok-missing")).toBeNull();
    });
  });

  it("updates the active business on a session", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const b1 = await seedBusiness(db);
      const b2 = await seedBusiness(db);
      const s = await db.createSession({
        userId: u.id, businessId: b1.id, activeBusinessId: null, activeBranchId: null, tokenHash: uniq("tok"),
        expiresAt: new Date(Date.now() + 60_000), revokedAt: null, authenticatedAt: new Date(),
        ip: null, userAgent: null, deviceId: null,
      });
      await db.updateSession(s.id, { activeBusinessId: b2.id });
      expect((await db.findSessionByTokenHash(s.tokenHash))!.activeBusinessId).toBe(b2.id);
    });
  });

  it("updates and clears the active branch on a session", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const b = await seedBusiness(db);
      const branch = await db.createBranch({ businessId: b.id, name: uniq("Branch"), type: "store", isActive: true });
      const s = await db.createSession({
        userId: u.id, businessId: b.id, activeBusinessId: null, activeBranchId: null, tokenHash: uniq("tok"),
        expiresAt: new Date(Date.now() + 60_000), revokedAt: null, authenticatedAt: new Date(),
        ip: null, userAgent: null, deviceId: null,
      });
      await db.updateSession(s.id, { activeBranchId: branch.id });
      expect((await db.findSessionByTokenHash(s.tokenHash))!.activeBranchId).toBe(branch.id);
      await db.updateSession(s.id, { activeBranchId: null });
      expect((await db.findSessionByTokenHash(s.tokenHash))!.activeBranchId).toBeNull();
    });
  });

  it("lists only live sessions of the user, excluding revoked ones", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const u2 = await seedUser(db);
      const b = await seedBusiness(db);
      const mk = async (tokenHash: string, owner = u) =>
        db.createSession({
          userId: owner.id, businessId: b.id, activeBusinessId: null, activeBranchId: null, tokenHash,
          expiresAt: new Date(Date.now() + 60_000), revokedAt: null, authenticatedAt: new Date(),
          ip: null, userAgent: null, deviceId: null,
        });
      const s1 = await mk("s-1");
      const s2 = await mk("s-2");
      await mk("s-other", u2);
      await db.revokeSession(s2.id);
      expect((await db.listSessionsByUser(u.id)).map((s) => s.id)).toEqual([s1.id]);
      expect((await db.listSessionsByUser(u2.id)).map((s) => s.id).length).toBe(1);
    });
  });

  it("revokes all user sessions except the given id", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const b = await seedBusiness(db);
      const mk = async (tokenHash: string) =>
        db.createSession({
          userId: u.id, businessId: b.id, activeBusinessId: null, activeBranchId: null, tokenHash,
          expiresAt: new Date(Date.now() + 60_000), revokedAt: null, authenticatedAt: new Date(),
          ip: null, userAgent: null, deviceId: null,
        });
      const s1 = await mk("r-1");
      const s2 = await mk("r-2");
      const s3 = await mk("r-3");
      await db.revokeAllUserSessions(u.id, s1.id);
      expect((await db.listSessionsByUser(u.id)).map((s) => s.id)).toEqual([s1.id]);
      // Without exceptId everything goes.
      await db.revokeAllUserSessions(u.id);
      expect(await db.listSessionsByUser(u.id)).toEqual([]);
      void s2; void s3;
    });
  });
});

describe("phase12 pg tenants: reset tokens", () => {
  it("saves, finds and marks a reset token used", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const expiresAt = new Date(Date.now() + 60_000);
      await db.saveResetToken({ userId: u.id, tokenHash: "rt-1", expiresAt, usedAt: null, requestId: "req-1", ip: "127.0.0.1" });
      const found = await db.findResetToken("rt-1");
      expect(found).toEqual({ userId: u.id, tokenHash: "rt-1", expiresAt, usedAt: null, requestId: "req-1", ip: "127.0.0.1" });
      const usedAt = new Date();
      await db.markResetTokenUsed("rt-1", usedAt);
      expect((await db.findResetToken("rt-1"))!.usedAt).toEqual(usedAt);
      expect(await db.findResetToken("rt-missing")).toBeNull();
    });
  });
});

describe("phase12 pg tenants: email verification tokens", () => {
  it("creates, finds and marks a verification token used regardless of expiry", async () => {
    await withPg(async (db) => {
      const u = await seedUser(db);
      const expiresAt = new Date(Date.now() - 1000);
      const created = await db.createEmailVerificationToken({ userId: u.id, tokenHash: "evt-1", expiresAt });
      expect(created.id).toBeTruthy();
      const found = await db.findEmailVerificationToken("evt-1");
      expect(found).toEqual({ id: created.id, userId: u.id, expiresAt, usedAt: null });
      await db.markEmailVerificationTokenUsed(created.id);
      expect((await db.findEmailVerificationToken("evt-1"))!.usedAt).not.toBeNull();
      expect(await db.findEmailVerificationToken("evt-missing")).toBeNull();
    });
  });
});

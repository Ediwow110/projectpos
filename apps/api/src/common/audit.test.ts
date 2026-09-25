import { describe, expect, it } from "vitest";
import { createMemoryDb } from "./memory.db";

describe("phase11 port additions", () => {
  it("stamps audit rows with a timestamp and keeps optional context", async () => {
    const db = createMemoryDb();
    await db.appendAudit({
      businessId: "b1", actorId: "u1", action: "settings.write",
      entityType: "Business", entityId: "b1", requestId: "r1",
      before: { a: 1 }, after: { a: 2 }, reason: "owner update",
    });
    const row = (await db.listAudit()).at(-1)!;
    expect(row.at).toBeInstanceOf(Date);
    expect(row.before).toEqual({ a: 1 });
    expect(row.reason).toBe("owner update");
  });

  it("stores and single-uses an email verification token", async () => {
    const db = createMemoryDb();
    await db.createEmailVerificationToken({ userId: "u1", tokenHash: "h1", expiresAt: new Date(Date.now() + 60000) });
    const found = await db.findEmailVerificationToken("h1");
    expect(found).not.toBeNull();
    await db.markEmailVerificationTokenUsed(found!.id);
    expect((await db.findEmailVerificationToken("h1"))!.usedAt).not.toBeNull();
  });

  it("returns only unexpired unused support grants", async () => {
    const db = createMemoryDb();
    await db.createSupportGrant({ purpose: "p", actorId: "ops", tokenHash: "g1", expiresAt: new Date(Date.now() + 60000) });
    await db.createSupportGrant({ purpose: "p", actorId: "ops", tokenHash: "g2", expiresAt: new Date(Date.now() - 60000) });
    expect((await db.findValidSupportGrant("g1"))!.purpose).toBe("p");
    expect(await db.findValidSupportGrant("g2")).toBeNull();
    const g1 = await db.findValidSupportGrant("g1");
    await db.markSupportGrantUsed(g1!.id);
    expect(await db.findValidSupportGrant("g1")).toBeNull();
  });

  it("persists session active business and membership deactivation", async () => {
    const db = createMemoryDb();
    const user = await db.createUser({ name: "U", email: `u${Date.now()}@x.test`, passwordHash: "h" });
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const m = await db.createMembership({ businessId: biz.id, userId: user.id, role: "owner" });
    const session = await db.createSession({
      userId: user.id, businessId: biz.id, tokenHash: "tok", expiresAt: new Date(Date.now() + 60000),
      revokedAt: null, authenticatedAt: new Date(), ip: null, userAgent: null,
    });
    await db.updateSession(session.id, { activeBusinessId: biz.id });
    expect((await db.findSessionByTokenHash("tok"))!.activeBusinessId).toBe(biz.id);
    await db.updateMembership(m.id, biz.id, { deactivatedAt: new Date() });
    expect((await db.findMembership(user.id, biz.id))!.deactivatedAt).not.toBeNull();
  });

  it("stores shift corrections and validates receipt shares", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const correction = await db.createShiftCorrection({
      businessId: biz.id, shiftId: "s1", amountMinor: -500, reason: "counted early",
      actorId: "u1", requestId: "r1",
    });
    expect(correction.id).toBeTruthy();
    expect(await db.listShiftCorrections(biz.id, "s1")).toHaveLength(1);
    await db.createReceiptShare({ businessId: biz.id, saleId: "sale1", tokenHash: "rh1", expiresAt: new Date(Date.now() + 60000) });
    expect((await db.findValidReceiptShare("rh1"))!.saleId).toBe("sale1");
  });
});

describe("phase12 port locks", () => {
  it("serializes same-key lock bodies on the memory port", async () => {
    const db = createMemoryDb();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = db.withLock("sales:b1", async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });
    const second = db.withLock("sales:b1", async () => {
      order.push("second:start");
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["first:start"]);
    release();
    await first;
    await second;
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("runs withTransaction bodies (memory: atomic by construction)", async () => {
    const db = createMemoryDb();
    const out = await db.withTransaction(async () => "ok");
    expect(out).toBe("ok");
  });
});

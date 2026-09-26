import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { MembershipService } from "./membership.service";

const OWNER = ["user.manage", "settings.write", "sale.refund"];

describe("phase11 membership management", () => {
  it("invites a new member with a one-time temp password and enforces user.manage", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const svc = new MembershipService(db);
    const out = await svc.create(biz.id, "u1", "r1", OWNER, {
      email: `c${Date.now()}@x.test`, name: "Cash Ier", role: "cashier",
    });
    expect(out.tempPassword).toHaveLength(16);
    const members = await svc.list(biz.id);
    expect(members.items).toHaveLength(1);
    expect(members.items[0]!.role).toBe("cashier");
    await expect(
      svc.create(biz.id, "u1", "r2", ["sale.refund"], {
        email: `d${Date.now()}@x.test`, name: "X", role: "cashier",
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("rejects a second owner and counts only active members against the cap", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const svc = new MembershipService(db);
    await expect(
      svc.create(biz.id, "u1", "r1", OWNER, { email: `o${Date.now()}@x.test`, name: "O", role: "owner" }),
    ).rejects.toThrow("VALIDATION");
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({
      businessId: biz.id, planId: free.id, status: "active", trialEndsAt: null,
      currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    // The owner seat exists only as a membership when seeded; the cap counts
    // live memberships, so seed one owner membership then fill the Free cap (3).
    await db.createMembership({ businessId: biz.id, userId: "u1", role: "owner" });
    await svc.create(biz.id, "u1", "r-a", OWNER, { email: `m1-${Date.now()}@x.test`, name: "M1", role: "cashier" });
    await svc.create(biz.id, "u1", "r-b", OWNER, { email: `m2-${Date.now()}@x.test`, name: "M2", role: "cashier" });
    await expect(
      svc.create(biz.id, "u1", "r-cap", OWNER, { email: `m3-${Date.now()}@x.test`, name: "M3", role: "cashier" }),
    ).rejects.toThrow("PLAN_LIMIT");
    const members = await svc.list(biz.id);
    const cashier = members.items.find((m) => m.role === "cashier")!;
    await svc.deactivate(biz.id, "u1", "r-deact", OWNER, cashier.id);
    const ok = await svc.create(biz.id, "u1", "r-after", OWNER, {
      email: `m4-${Date.now()}@x.test`, name: "M4", role: "cashier",
    });
    expect(ok.membershipId).toBeTruthy();
  });

  it("refuses to deactivate the last active owner", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const svc = new MembershipService(db);
    const out = await svc.create(biz.id, "u1", "r1", OWNER, {
      email: `own${Date.now()}@x.test`, name: "Solo", role: "manager",
    });
    const ownerMem = await db.createMembership({ businessId: biz.id, userId: "u1", role: "owner" });
    await expect(svc.deactivate(biz.id, "u1", "r2", OWNER, ownerMem.id)).rejects.toThrow("VALIDATION");
    const members = await svc.list(biz.id);
    expect(members.items.find((m) => m.id === out.membershipId)!.deactivatedAt).toBeNull();
  });

  it("does not exceed the user cap under concurrent invites", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Concurrent Seats", currency: "PHP" });
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({
      businessId: biz.id,
      planId: free.id,
      status: "active",
      trialEndsAt: null,
      currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    await db.createMembership({ businessId: biz.id, userId: "owner-1", role: "owner" });
    await db.createMembership({ businessId: biz.id, userId: "manager-1", role: "manager" });
    const svc = new MembershipService(db);

    const outcomes = await Promise.allSettled([
      svc.create(biz.id, "owner-1", "r-a", OWNER, {
        email: `seat-a-${Date.now()}@x.test`, name: "Seat A", role: "cashier",
      }),
      svc.create(biz.id, "owner-1", "r-b", OWNER, {
        email: `seat-b-${Date.now()}@x.test`, name: "Seat B", role: "cashier",
      }),
    ]);

    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await svc.list(biz.id)).items).toHaveLength(3);
  });
});

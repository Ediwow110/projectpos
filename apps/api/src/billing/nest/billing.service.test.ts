import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BillingService } from "./billing.service";

describe("phase10 entitlement port", () => {
  it("seeds the four plans in a fresh store", async () => {
    const db = createMemoryDb();
    expect((await db.listPlans()).map((p) => p.key).sort()).toEqual(["basic", "enterprise", "free", "pro"]);
    expect(await db.findPlanByKey("nope")).toBeNull();
  });
});

describe("phase10 entitlement service", () => {
  it("defaults missing subscriptions to enterprise (grandfathering)", async () => {
    const db = createMemoryDb();
    const svc = new BillingService(db);
    const plan = await svc.resolvePlan("b1");
    expect(plan.key).toBe("enterprise");
    await svc.requireCreate("b1", "u1", "r1", "products");
  });
  it("expires trials to free and caps product creation", async () => {
    const db = createMemoryDb();
    const svc = new BillingService(db);
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({ businessId: "b1", planId: free.id, status: "trialing", trialEndsAt: new Date("2020-01-01T00:00:00.000Z"), currentPeriodEnd: new Date("2020-01-15T00:00:00.000Z") });
    expect((await svc.resolvePlan("b1")).key).toBe("free");
    for (let i = 0; i < 100; i++) {
      await db.createProduct({ businessId: "b1", categoryId: null, name: `P${i}`, sku: null, barcode: null, brand: null, unit: "pc", costMinor: 0, priceMinor: 100, taxRateBps: null, reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null });
    }
    await expect(svc.requireCreate("b1", "u1", "r1", "products")).rejects.toThrow("PLAN_LIMIT");
    const rebuilt = await svc.rebuildCounters("b1");
    expect(rebuilt.checked).toBeGreaterThanOrEqual(5);
  });
  it("gates features by plan with flag overrides", async () => {
    const db = createMemoryDb();
    const svc = new BillingService(db);
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({ businessId: "b1", planId: free.id, status: "active", trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z") });
    expect(await svc.checkFeature("b1", "reports")).toBe(false);
    await expect(svc.requireFeature("b1", "reports")).rejects.toThrow("PLAN_LIMIT");
    await db.setFlag({ businessId: "b1", key: "reports", enabled: true });
    expect(await svc.checkFeature("b1", "reports")).toBe(true);
    await svc.requireFeature("b1", "reports");
  });
});

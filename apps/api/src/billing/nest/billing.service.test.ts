import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BillingService } from "./billing.service";
import { AuthService } from "../../auth/nest/auth.service";

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

describe("phase10 usage metering", () => {
  it("counts only this month's sales and advances the counter on completion", async () => {
    const db = createMemoryDb();
    const { SalesService } = await import("../../sales/nest/sales.service");
    const sales = new SalesService(db);
    const billing = new BillingService(db);
    const product = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Cola", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null,
    });
    // A completed sale from last month must not inflate this month's usage.
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    await db.createSale({
      businessId: "b1", receiptNo: "OLD-0001", status: "COMPLETED",
      customerId: null, customerName: null, userId: "u1", registerId: null, branchId: null,
      subtotalMinor: 2500, discountMinor: 0, taxMinor: 0, totalMinor: 2500,
      paidMinor: 2500, changeMinor: 0, idempotencyKey: null, shiftId: null,
      completedAt: lastMonth, createdAt: lastMonth, items: [], payments: [],
    });

    const draft = await sales.createDraft("b1", "u1", "r1", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, []);
    await sales.completeSale("b1", "u1", "r1", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "meter-1", granted: [],
    });

    const summary = await billing.usageSummary("b1");
    expect(summary.salesMonthly).toBe(1);
    const period = new Date().toISOString().slice(0, 7);
    const counter = (await db.listCounters("b1")).find((c) => c.key === "sales.monthly");
    expect(counter?.period).toBe(period);
    expect(counter?.count).toBe(1);
  });

  it("rebuilds the monthly counter from live sales and reports drift", async () => {
    const db = createMemoryDb();
    const billing = new BillingService(db);
    await db.setCounter("b1", "sales.monthly", new Date().toISOString().slice(0, 7), 9);
    const rebuilt = await billing.rebuildCounters("b1");
    const counter = (await db.listCounters("b1")).find((c) => c.key === "sales.monthly");
    expect(counter?.count).toBe(0);
    expect(rebuilt.drifts.some((d) => d.key.startsWith("sales.monthly"))).toBe(true);
  });
});

describe("phase10 trial on registration", () => {
  it("starts new businesses on a 14-day pro trial", async () => {
    const db = createMemoryDb();
    const auth = new AuthService(db);
    const out = await auth.register(
      { ownerName: "Ana", email: "ana@example.com", password: "correct-horse-12", businessName: "Sari Store" },
      { requestId: "r1", ip: null, userAgent: null },
    );
    const sub = await db.getSubscription(out.business.id);
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe("trialing");
    const pro = await db.findPlanByKey("pro");
    expect(sub!.planId).toBe(pro!.id);
    const trialMs = sub!.trialEndsAt!.getTime() - Date.now();
    expect(trialMs).toBeGreaterThan(13 * 86400000);
    expect(trialMs).toBeLessThanOrEqual(14 * 86400000);
    expect((await db.listAudit()).some((a) => a.action === "subscription.created")).toBe(true);
    const svc = new BillingService(db);
    expect((await svc.resolvePlan(out.business.id)).key).toBe("pro");
  });
});

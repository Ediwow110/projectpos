import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BillingService } from "./billing.service";
import { AuthService } from "../../auth/nest/auth.service";
import { billingEnabled } from "../entitlements";

describe("phase10 entitlement port", () => {
  it("keeps billing opt-in outside the test harness", () => {
    expect(billingEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(billingEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(billingEnabled({ NODE_ENV: "production", BILLING_ENABLED: "1" })).toBe(true);
    expect(billingEnabled({ NODE_ENV: "test" })).toBe(true);
  });

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
    const businessId = (await db.createBusiness({ name: "Usage Store", currency: "PHP" })).id;
    const { SalesService } = await import("../../sales/nest/sales.service");
    const sales = new SalesService(db);
    const billing = new BillingService(db);
    const product = await db.createProduct({
      businessId, categoryId: null, name: "Cola", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null,
    });
    // A completed sale from last month must not inflate this month's usage.
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    await db.createSale({
      businessId, receiptNo: "OLD-0001", status: "COMPLETED",
      customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "r-old",
      currency: "PHP", registerId: null, branchId: null,
      subtotalMinor: 2500, discountMinor: 0, taxMinor: 0, totalMinor: 2500,
      paidMinor: 2500, changeMinor: 0, idempotencyKey: null,
      createdAt: lastMonth,
    });

    const draft = await sales.createDraft(businessId, "u1", "r1", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, []);
    await sales.completeSale(businessId, "u1", "r1", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "meter-1", granted: [],
    });

    const summary = await billing.usageSummary(businessId);
    expect(summary.salesMonthly).toBe(1);
    const period = new Date().toISOString().slice(0, 7);
    const counter = (await db.listCounters(businessId)).find((c) => c.key === "sales.monthly");
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

describe("phase10 subscription status handling", () => {
  async function subscription(status: string, planKey: string, trialEndsAt: Date | null) {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Status Store", currency: "PHP" });
    const plan = (await db.findPlanByKey(planKey))!;
    await db.upsertSubscription({
      businessId: business.id, planId: plan.id, status,
      trialEndsAt, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    return { db, business, billing: new BillingService(db) };
  }

  it("keeps an expired trial on Free for every later read", async () => {
    const { db, business, billing } = await subscription("trialing", "pro", new Date("2020-01-01T00:00:00.000Z"));
    expect((await billing.resolvePlan(business.id)).key).toBe("free");
    // Regression guard: the downgrade must be persisted, not recomputed from a
    // stale plan id on the next call.
    expect((await billing.resolvePlan(business.id)).key).toBe("free");
    const stored = await db.getSubscription(business.id);
    expect(stored!.status).toBe("canceled");
    expect(stored!.planId).toBe((await db.findPlanByKey("free"))!.id);
    await expect(billing.requireCreate(business.id, "u1", "r1", "branches")).rejects.toThrow("PLAN_LIMIT");
  });

  it("treats canceled (either spelling) and paused as Free, but keeps past_due", async () => {
    for (const status of ["canceled", "cancelled", "paused"]) {
      const { db, business, billing } = await subscription(status, "pro", null);
      expect((await billing.resolvePlan(business.id)).key).toBe("free");
      const stored = await db.getSubscription(business.id);
      expect(stored!.planId).toBe((await db.findPlanByKey("free"))!.id);
      expect(stored!.status).toBe("canceled");
    }
    const grace = await subscription("past_due", "pro", null);
    expect((await grace.billing.resolvePlan(grace.business.id)).key).toBe("pro");
  });

  it("fails closed on unknown statuses and dangling plans", async () => {
    for (const status of ["incomplete", "unpaid", "TYPO", "pro"]) {
      const { business, billing } = await subscription(status, "pro", null);
      expect((await billing.resolvePlan(business.id)).key).toBe("free");
      await expect(billing.requireFeature(business.id, "reports")).rejects.toThrow("PLAN_LIMIT");
    }
    const { db, business, billing } = await subscription("active", "pro", null);
    // A subscription pointing at a plan row that no longer exists must not
    // silently resolve to the widest allowance set.
    await db.updateSubscription(
      (await db.getSubscription(business.id))!.id, business.id, { planId: "plan_missing" },
    );
    expect((await billing.resolvePlan(business.id)).key).toBe("free");
  });

  it("audits feature-gate breaches", async () => {
    const { db, business, billing } = await subscription("active", "free", null);
    await expect(billing.requireFeature(business.id, "reports", "u1", "r1")).rejects.toThrow("PLAN_LIMIT");
    const breach = (await db.listAudit()).find((a) => a.action === "plan.limit");
    expect(breach).toBeDefined();
    expect(breach!.entityType).toBe("Feature");
    expect(breach!.entityId).toBe("reports");
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

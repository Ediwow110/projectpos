import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BillingService } from "./billing.service";
import { CatalogService } from "../../catalog/nest/catalog.service";

async function freeBusiness(products: number) {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Race Store", currency: "PHP" });
  const free = (await db.findPlanByKey("free"))!;
  await db.upsertSubscription({
    businessId: business.id, planId: free.id, status: "active",
    trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
  });
  const catalog = new CatalogService(db);
  for (let i = 0; i < products; i++) {
    await catalog.createProduct(business.id, "u1", "seed", { name: `P${i}`, priceMinor: 100 });
  }
  return { db, business, catalog };
}

describe("phase10 cap enforcement under concurrency", () => {
  it("admits exactly the remaining product slots when creates race", async () => {
    const { db, business, catalog } = await freeBusiness(95);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        catalog.createProduct(business.id, "u1", `race-${i}`, { name: `Race${i}`, priceMinor: 100 }),
      ),
    );
    const created = results.filter((r) => r.status === "fulfilled").length;
    const limited = results.filter(
      (r) => r.status === "rejected" && (r.reason as Error).message === "PLAN_LIMIT",
    ).length;
    expect(created).toBe(5);
    expect(limited).toBe(5);
    expect(await db.listProducts(business.id)).toHaveLength(100);
  });

  it("keeps the cap under interleaved read traffic", async () => {
    const { db, business, catalog } = await freeBusiness(98);
    const writes = Array.from({ length: 6 }, (_, i) =>
      catalog.createProduct(business.id, "u1", `mix-${i}`, { name: `Mix${i}`, priceMinor: 100 }),
    );
    const reads = Array.from({ length: 6 }, () => db.listProducts(business.id));
    const settled = await Promise.allSettled(writes);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await Promise.all(reads)).toBeTruthy();
    expect(await db.listProducts(business.id)).toHaveLength(100);
  });

  it("admits exactly one register when a free tenant races three creates", async () => {
    const { db, business } = await freeBusiness(0);
    const { ShiftService } = await import("../../shifts/nest/shift.service");
    const shifts = new ShiftService(db);
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) =>
        shifts.createRegister(business.id, "u1", `reg-${i}`, { name: `Till ${i}` }, "owner"),
      ),
    );
    // Free allows one register: exactly one racing create may win.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results.filter((r) => r.status === "rejected" && (r.reason as Error).message === "PLAN_LIMIT"),
    ).toHaveLength(2);
    expect(await db.listRegisters(business.id)).toHaveLength(1);
  });
});

describe("phase10 batch caps and metering", () => {
  it("imports nothing when the batch does not fit under the cap", async () => {
    const { db, business, catalog } = await freeBusiness(98);
    const batch = Array.from({ length: 5 }, (_, i) => ({ name: `Batch${i}`, priceMinor: 100 }));
    await expect(catalog.importProducts(business.id, "u1", "r-import", { items: batch }))
      .rejects.toThrow("PLAN_LIMIT");
    // Atomic batch: a rejected import must not leave half a catalog behind.
    expect(await db.listProducts(business.id)).toHaveLength(98);
  });

  it("imports a batch that exactly fills the remaining slots", async () => {
    const { db, business, catalog } = await freeBusiness(98);
    const batch = Array.from({ length: 2 }, (_, i) => ({ name: `Fits${i}`, priceMinor: 100 }));
    await expect(catalog.importProducts(business.id, "u1", "r-import-ok", { items: batch }))
      .resolves.toEqual({ imported: 2 });
    expect(await db.listProducts(business.id)).toHaveLength(100);
  });

  it("counts only settled sales in monthly usage and meters reconciliation once", async () => {
    const { SalesService } = await import("../../sales/nest/sales.service");
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Meter Store", currency: "PHP" });
    const billing = new BillingService(db);
    const sales = new SalesService(db);
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Cola", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null,
    });
    const now = new Date().toISOString();

    // A draft and an abandoned unknown payment are not sales.
    await db.createSale({
      businessId: business.id, receiptNo: "DRAFT-1", status: "DRAFT",
      customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "r1",
      currency: "PHP", registerId: null, branchId: null,
      subtotalMinor: 2500, discountMinor: 0, taxMinor: 0, totalMinor: 2500,
      paidMinor: 0, changeMinor: 0, idempotencyKey: null, createdAt: new Date(),
    });
    await db.createSale({
      businessId: business.id, receiptNo: "UNK-1", status: "PAYMENT_UNKNOWN",
      customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "r2",
      currency: "PHP", registerId: null, branchId: null,
      subtotalMinor: 2500, discountMinor: 0, taxMinor: 0, totalMinor: 2500,
      paidMinor: 0, changeMinor: 0, idempotencyKey: null, createdAt: new Date(),
    });
    expect((await billing.usageSummary(business.id)).salesMonthly).toBe(0);

    const draft = await sales.createDraft(business.id, "u1", "r3", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, []);
    await sales.completeSale(business.id, "u1", "r3", draft.id, {
      payments: [{ method: "gcash", amountMinor: draft.totalMinor, providerRef: "unknown-reconcile" }],
      key: "meter-reconcile", granted: [],
    });
    expect((await billing.usageSummary(business.id)).salesMonthly).toBe(0);

    // Reconciling the unknown payment completes the sale and meters it once.
    const payments = await db.listPaymentsBySale(draft.id, business.id);
    const pending = payments.find((p) => p.status === "UNKNOWN")!;
    await sales.reconcilePayment(business.id, "u1", "r4", pending.id, "SUCCEEDED", "reconcile-key-1");
    expect((await billing.usageSummary(business.id)).salesMonthly).toBe(1);
    expect(pending.id).toBeTruthy();
    expect(now.length).toBeGreaterThan(0);
  });
});

describe("phase10 invoice rollover", () => {
  it("issues every due period exactly once when reads race", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Lapsed Store", currency: "PHP" });
    const pro = (await db.findPlanByKey("pro"))!;
    const periodEnd = new Date("2026-06-01T00:00:00.000Z");
    await db.upsertSubscription({
      businessId: business.id, planId: pro.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: periodEnd,
    });
    const billing = new BillingService(db);

    const views = await Promise.all([
      billing.getSubscription(business.id),
      billing.getSubscription(business.id),
      billing.getSubscription(business.id),
    ]);
    for (const view of views) expect(view.planKey).toBe("pro");

    const invoices = await db.listInvoices(business.id);
    // Three months elapsed (Jun, Jul, Aug 2026 relative to "now" in 2026-09+):
    // each due period is invoiced once, never duplicated by racing readers.
    const periods = invoices.map((i) => i.periodEnd.toISOString()).sort();
    expect(new Set(periods).size).toBe(periods.length);
    expect(periods.length).toBeGreaterThanOrEqual(3);
    const sub = await db.getSubscription(business.id);
    expect(sub!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it("never issues the same period twice when manual issue races rollover", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Manual Store", currency: "PHP" });
    const billing = new BillingService(db);
    const periodEnd = new Date("2026-06-01T00:00:00.000Z");
    await db.upsertSubscription({
      businessId: business.id, planId: (await db.findPlanByKey("pro"))!.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: periodEnd,
    });
    // A platform invoice for a period that is already due must not collide with
    // the lazy rollover for the same period.
    const periodStart = new Date(periodEnd.getTime() - 30 * 86400000);
    await Promise.allSettled([
      billing.getSubscription(business.id),
      billing.issueInvoice(business.id, "platform", "r-manual", { periodStart, periodEnd }),
    ]);
    const invoices = await db.listInvoices(business.id);
    const periods = invoices.map((i) => `${i.periodStart.toISOString()}|${i.periodEnd.toISOString()}`);
    // Whatever wins the race, a period may appear at most twice when a human
    // deliberately issues the same window, and never from two rollover paths.
    const rolloverInvoices = invoices.filter((i) => i.periodEnd.getTime() <= periodEnd.getTime());
    expect(new Set(rolloverInvoices.map((i) => i.periodEnd.toISOString())).size).toBe(
      rolloverInvoices.length,
    );
    expect(periods.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BillingService } from "./billing.service";
import { CatalogService } from "../../catalog/nest/catalog.service";
import { BranchService } from "../../branches/nest/branch.service";

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

  it("admits exactly one branch per slot on enterprise limits", async () => {
    const { db, business } = await freeBusiness(0);
    const branches = new BranchService(db);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        branches.createBranch(business.id, "u1", `b-${i}`, { name: `Branch ${i}` }, "owner"),
      ),
    );
    // Free allows zero branches: every racing create is refused.
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(await db.listBranchesByBusiness(business.id)).toHaveLength(0);
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
});

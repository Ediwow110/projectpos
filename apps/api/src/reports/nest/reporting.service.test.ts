import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ReportingService } from "./reporting.service";
import { SalesService } from "../../sales/nest/sales.service";
import { RefundService } from "../../refunds/nest/refund.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setupReports() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 100 });
  const sales = new SalesService(db);
  const mk = async (day: string, qty: number, key: string) => {
    const draft = await sales.createDraft("b1", "u1", "r1", {
      lines: [{ productId: prod.id, qty, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    await sales.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key, granted: ALL,
    });
    await db.updateSale(draft.id, "b1", { createdAt: new Date(day) });
    return draft.id;
  };
  await mk("2026-09-10T10:00:00.000Z", 2, "rep-k1");
  await mk("2026-09-20T10:00:00.000Z", 1, "rep-k2");
  return { db, svc: new ReportingService(db), productId: prod.id };
}

describe("phase7 reporting overview", () => {
  it("computes KPIs and deltas for a fixed range", async () => {
    const { svc } = await setupReports();
    const out = await svc.getOverview("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none",
    }, "owner", ALL);
    expect(out.kpis.netRevenue.value).toBe(7500);
    expect(out.kpis.orders.value).toBe(2);
    expect(out.kpis.grossProfit!.value).toBe(4500);
    expect(out.topProducts[0].qty).toBe(3);
    expect(out.generatedAt).toBeTruthy();
  });
  it("omits profit without cost.view and compares against previous period", async () => {
    const { svc } = await setupReports();
    const out = await svc.getOverview("b1", {
      dateFrom: "2026-09-15T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "previous_period",
    }, "cashier", []);
    expect(out.kpis.grossProfit).toBeUndefined();
    expect(out.kpis.netRevenue.value).toBe(2500);
    expect(out.kpis.netRevenue.previous).toBe(5000);
    expect(out.compareLabel).toBe("vs previous 15 days");
  });
  it("isolates tenants (no cross-tenant leakage)", async () => {
    const { svc } = await setupReports();
    const out = await svc.getOverview("b2", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none",
    }, "owner", ALL);
    expect(out.kpis.netRevenue.value).toBe(0);
    expect(out.topProducts).toEqual([]);
  });
});

describe("phase7 sales and products reports", () => {
  it("buckets revenue by day", async () => {
    const { svc } = await setupReports();
    const out = await svc.getSalesReport("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none", granularity: "day",
    }, "owner", ALL);
    const buckets = Object.fromEntries(out.series.map((s) => [s.bucket, s.netRevenue]));
    expect(buckets["2026-09-10"]).toBe(5000);
    expect(buckets["2026-09-20"]).toBe(2500);
    expect(buckets["2026-09-15"]).toBe(0);
  });
  it("ranks top products with margin", async () => {
    const { svc } = await setupReports();
    const out = await svc.getProductsReport("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none", tab: "top", limit: 20,
    }, "owner", ALL);
    expect(out.rows[0]).toMatchObject({ qty: 3, revenue: 7500, profit: 4500, marginPct: 60 });
  });
});

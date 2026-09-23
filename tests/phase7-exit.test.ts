import { describe, expect, it } from "vitest";
import { isSettled } from "../apps/api/src/reports/aggregate";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";
import { ReportingService } from "../apps/api/src/reports/nest/reporting.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setup() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 50 });
  await db.createProduct({
    businessId: "b1", categoryId: null, name: "Pepsi", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 900, priceMinor: 2400, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  const sales = new SalesService(db);
  const draft = await sales.createDraft("b1", "u1", "r1", {
    lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
  }, ALL);
  await sales.completeSale("b1", "u1", "r2", draft.id, {
    payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit7-1", granted: ALL,
  });
  await db.updateSale(draft.id, "b1", { createdAt: new Date("2026-09-10T10:00:00.000Z") });
  return { db, svc: new ReportingService(db) };
}

describe("phase7 exit", () => {
  it("owner dashboard answers from source records", async () => {
    const { svc } = await setup();
    const out = await svc.getOverview("b1", {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "owner", ALL);
    expect(out.kpis.netRevenue.value).toBe(5000);
    expect(out.kpis.grossProfit!.value).toBe(3000);
    expect(out.topProducts).toHaveLength(1);
    expect(out.attention.some((a) => a.kind === "out_of_stock")).toBe(true);
  });
  it("settled filter excludes drafts and voids", () => {
    expect(isSettled("COMPLETED")).toBe(true);
    expect(isSettled("DRAFT")).toBe(false);
    expect(isSettled("VOIDED")).toBe(false);
  });
  it("cashier gets no profit and no cashiers view", async () => {
    const { svc } = await setup();
    const out = await svc.getOverview("b1", { compare: "none" }, "cashier", []);
    expect(out.kpis.grossProfit).toBeUndefined();
    await expect(svc.getCashiersReport("b1", { compare: "none" }, "cashier")).rejects.toThrow("FORBIDDEN");
  });
  it("empty business returns zeros, never errors", async () => {
    const svc = new ReportingService(createMemoryDb());
    const out = await svc.getOverview("b9", { compare: "none" }, "owner", ALL);
    expect(out.kpis.netRevenue.value).toBe(0);
    expect(out.topProducts).toEqual([]);
  });
});

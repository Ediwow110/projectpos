import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ReportingService } from "./reporting.service";
import { SalesService } from "../../sales/nest/sales.service";
import { RefundService } from "../../refunds/nest/refund.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setupReports() {
  const db = createMemoryDb();
  const businessId = (await db.createBusiness({ name: "Reporting", currency: "PHP" })).id;
  const prod = await db.createProduct({
    businessId: businessId, categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: businessId, productId: prod.id, qtyOnHand: 100 });
  const sales = new SalesService(db);
  const mk = async (day: string, qty: number, key: string) => {
    const draft = await sales.createDraft(businessId, "u1", "r1", {
      lines: [{ productId: prod.id, qty, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    await sales.completeSale(businessId, "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key, granted: ALL,
    });
    await db.updateSale(draft.id, businessId, { createdAt: new Date(day) });
    return draft.id;
  };
  await mk("2026-09-10T10:00:00.000Z", 2, "rep-k1");
  await mk("2026-09-20T10:00:00.000Z", 1, "rep-k2");
  return { db, businessId, svc: new ReportingService(db), productId: prod.id };
}

describe("phase7 reporting overview", () => {
  it("separates merchandise, delivery revenue/tax, excludes gift-card liability, and includes delivery refunds", async () => {
    const db = createMemoryDb();
    const businessId = (await db.createBusiness({ name: "Delivery reporting", currency: "PHP" })).id;
    const product = await db.createProduct({
      businessId, categoryId: null, name: "Report item", sku: "REP-D", barcode: null,
      brand: null, unit: "pc", costMinor: 500, priceMinor: 5000, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId, productId: product.id, qtyOnHand: 9 });
    const createdAt = new Date("2026-09-15T12:00:00.000Z");
    const sale = await db.createSale({
      businessId, receiptNo: "REP-DEL-1", status: "COMPLETED",
      subtotalMinor: 5000, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 1000, deliveryTaxMinor: 120,
      totalMinor: 7120, paidMinor: 7120, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
      notes: null, actorId: "u1", requestId: "report-delivery", idempotencyKey: null, registerId: null, branchId: null,
      completedAt: createdAt, createdAt,
    });
    const item = await db.createSaleItem({
      businessId: sale.businessId, saleId: sale.id, productId: product.id, name: product.name, unit: "pc",
      qty: 1, priceMinor: 5000, costMinor: 500, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 5000,
    });
    await db.createSaleGiftCardLoad({
      businessId: sale.businessId, saleId: sale.id, amountMinor: 1000, kind: "NEW",
      giftCardId: null,
    });
    await db.createPayment({
      businessId: sale.businessId, saleId: sale.id, method: "cash", amountMinor: 7120,
      status: "SUCCEEDED", providerRef: null, idempotencyKey: "report-delivery-pay",
    });
    const refunds = new RefundService(db);
    await refunds.approveRefund(sale.businessId, "u1", "report-delivery-refund", sale.id, {
      items: [],
      deliveryRefundMinor: 1120,
      key: "report-delivery-refund-key",
    }, ALL, "owner");

    const out = await new ReportingService(db).getSalesReport(sale.businessId, {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T23:59:59.999Z",
      compare: "none", granularity: "day",
    }, "owner", ALL);
    expect(out.totals).toMatchObject({
      merchandiseRevenue: 5000,
      deliveryRevenue: 0,
      deliveryTax: 0,
      netRevenue: 5000,
      refundTotal: 1120,
    });
    expect(out.totals.grossProfit).toBe(4500);
    expect(item.lineTotalMinor).toBe(5000);
  });

  it("computes KPIs and deltas for a fixed range", async () => {
    const { svc, businessId } = await setupReports();
    const out = await svc.getOverview(businessId, {
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
    const { svc, businessId } = await setupReports();
    const out = await svc.getOverview(businessId, {
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

  it("separates merchandise, delivery revenue/tax, delivery refunds, and gift-card liability", async () => {
    const db = createMemoryDb();
    const product = await db.createProduct({
      businessId: "b-delivery-report", categoryId: null, name: "Report item", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 500, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null,
    });
    const createdAt = new Date("2026-09-12T10:00:00.000Z");
    const sale = await db.createSale({
      businessId: "b-delivery-report", receiptNo: "REP-DEL-1", status: "PARTIALLY_REFUNDED",
      subtotalMinor: 2500, discountMinor: 0, taxMinor: 0,
      deliveryFeeMinor: 1000, deliveryTaxMinor: 120, totalMinor: 4120,
      paidMinor: 4120, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
      notes: null, actorId: "u1", requestId: "report-delivery", idempotencyKey: null,
      registerId: null, branchId: null, completedAt: createdAt, createdAt,
    });
    await db.createSaleItem({
      businessId: sale.businessId, saleId: sale.id, productId: product.id, name: product.name, unit: "pc",
      qty: 1, priceMinor: 2500, costMinor: 500, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 2500,
    });
    await db.createSaleGiftCardLoad({
      businessId: sale.businessId, saleId: sale.id, giftCardId: null, amountMinor: 500, kind: "NEW",
    });
    await db.createRefund({
      businessId: sale.businessId, saleId: sale.id, status: "APPROVED", totalMinor: 1120,
      deliveryFeeRefundMinor: 1000, deliveryTaxRefundMinor: 120, reason: "Delivery issue",
      requestedBy: "u1", approvedBy: "u1", requestId: "report-refund", approvedRequestId: "report-refund",
      singleStep: true,
    });

    const out = await new ReportingService(db).getOverview(sale.businessId, {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "owner", ALL);
    expect(out.kpis.merchandiseRevenue.value).toBe(2500);
    expect(out.kpis.deliveryRevenue.value).toBe(0);
    expect(out.kpis.deliveryTax.value).toBe(0);
    expect(out.kpis.refundTotal.value).toBe(1120);
    expect(out.kpis.netRevenue.value).toBe(2500);
  });
});

describe("phase7 sales and products reports", () => {
  it("buckets revenue by day", async () => {
    const { svc, businessId } = await setupReports();
    const out = await svc.getSalesReport(businessId, {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none", granularity: "day",
    }, "owner", ALL);
    const buckets = Object.fromEntries(out.series.map((s) => [s.bucket, s.netRevenue]));
    expect(buckets["2026-09-10"]).toBe(5000);
    expect(buckets["2026-09-20"]).toBe(2500);
    expect(buckets["2026-09-15"]).toBe(0);
  });
  it("ranks top products with margin", async () => {
    const { svc, businessId } = await setupReports();
    const out = await svc.getProductsReport(businessId, {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z",
      compare: "none", tab: "top", limit: 20,
    }, "owner", ALL);
    expect(out.rows[0]).toMatchObject({ qty: 3, revenue: 7500, profit: 4500, marginPct: 60 });
  });
});

describe("phase7 inventory payments cash customers cashiers", () => {
  it("reports inventory health and low stock", async () => {
    const { svc, productId, businessId } = await setupReports();
    void productId;
    const out = await svc.getInventoryReport(businessId);
    expect(out.low).toBe(0);
    expect(out.out).toBe(0);
    expect(out.healthy).toBe(1);
    expect(out.movements.sold).toBe(3);
  });
  it("breaks payments down by method", async () => {
    const { svc, businessId } = await setupReports();
    const out = await svc.getPaymentsReport(businessId, {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "owner", ALL);
    expect(out.byMethod).toEqual([{ method: "cash", total: 7500, count: 2 }]);
    expect(out.unknown).toBe(0);
  });
  it("tops customers by spend without PII", async () => {
    const { db, svc, businessId } = await setupReports();
    const cust = await db.createCustomer({
      businessId: businessId, name: "Ana", phone: "0917", email: null,
      address: null, notes: null, isActive: true,
    });
    const sales = new SalesService(db);
    const draft = await sales.createDraft(businessId, "u1", "rx", {
      lines: [{ productId: (await db.listProducts(businessId))[0].id, qty: 1, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0, customerId: cust.id,
    }, ALL);
    await sales.completeSale(businessId, "u1", "ry", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "top-cust-1", granted: ALL,
    });
    await db.updateSale(draft.id, businessId, { createdAt: new Date("2026-09-21T10:00:00.000Z") });
    const out = await svc.getCustomersReport(businessId, {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "cashier");
    expect(out.total).toBe(1);
    expect(out.top[0]).toMatchObject({ name: "Ana", spend: 2500, orders: 1 });
    expect(out.top[0]).not.toHaveProperty("phone");
  });
  it("forbids the cashiers view for non-managers", async () => {
    const { svc, businessId } = await setupReports();
    await expect(svc.getCashiersReport(businessId, {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "cashier")).rejects.toThrow("FORBIDDEN");
    const out = await svc.getCashiersReport(businessId, {
      dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none",
    }, "owner");
    expect(out.actors[0]).toMatchObject({ sales: 7500, orders: 2 });
  });
});

import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../common/memory.db";
import type { DbPayment, DbSale } from "../common/db.port";
import { SalesPaymentReconciliationService } from "./payment-reconciliation-service";
import { OrderSaleService } from "../orders/order-sale-service";
import { ReservationService } from "../orders/reservation-service";
import { SalesService } from "./nest/sales.service";
import { createMemoryOrderNotificationOutbox } from "../orders/order-notification-outbox";

async function setup() {
  const db = createMemoryDb();
  const sale = await db.createSale({
    businessId: "b1",
    receiptNo: "2026-000001",
    status: "PAYMENT_UNKNOWN",
    subtotalMinor: 5000,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 5000,
    paidMinor: 0,
    changeMinor: 0,
    currency: "PHP",
    customerId: null,
    customerName: null,
    notes: null,
    actorId: "u1",
    requestId: "r1",
    idempotencyKey: "sale-key",
    registerId: null,
    branchId: null,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
  });
  const first = await db.createPayment({
    businessId: "b1",
    saleId: sale.id,
    method: "gcash",
    amountMinor: 2500,
    status: "UNKNOWN",
    providerRef: "ref-1",
    idempotencyKey: "pay-1",
  });
  const second = await db.createPayment({
    businessId: "b1",
    saleId: sale.id,
    method: "maya",
    amountMinor: 2500,
    status: "UNKNOWN",
    providerRef: "ref-2",
    idempotencyKey: "pay-2",
  });
  let stockApplications = 0;
  let metered = 0;
  const requireSale = async (businessId: string, saleId: string): Promise<DbSale> => {
    const row = await db.findSaleById(saleId, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  };
  const embedSale = async (row: DbSale) => ({
    ...row,
    items: await db.listSaleItems(row.id, row.businessId),
    payments: await db.listPaymentsBySale(row.id, row.businessId),
  });
  const service = new SalesPaymentReconciliationService(db, {
    requireSale,
    embedSale,
    applyStockEffect: async () => { stockApplications += 1; },
    postCashSale: async () => undefined,
    recordSale: async () => { metered += 1; },
  });
  return { db, sale, first, second, service, effects: () => ({ stockApplications, metered }) };
}

describe("sales payment reconciliation service", () => {
  it("waits for all unknown legs, then completes and meters exactly once", async () => {
    const { sale, first, second, service, effects } = await setup();

    const partial = await service.reconcilePayment("b1", "u1", "r2", first.id, "SUCCEEDED", "rec-1");
    expect(partial.sale.status).toBe("PAYMENT_UNKNOWN");
    expect(effects()).toEqual({ stockApplications: 0, metered: 0 });

    const done = await service.reconcilePayment("b1", "u1", "r3", second.id, "SUCCEEDED", "rec-2");
    expect(done.sale.status).toBe("COMPLETED");
    expect(done.sale.id).toBe(sale.id);
    expect(effects()).toEqual({ stockApplications: 1, metered: 1 });

    const replay = await service.reconcilePayment("b1", "u1", "r4", second.id, "SUCCEEDED", "rec-2");
    expect(replay.sale.status).toBe("COMPLETED");
    expect(effects()).toEqual({ stockApplications: 1, metered: 1 });
  });

  it("moves the sale to payment failed when one resolved leg fails", async () => {
    const { first, second, service, effects } = await setup();

    await service.reconcilePayment("b1", "u1", "r2", first.id, "SUCCEEDED", "rec-a");
    const failed = await service.reconcilePayment("b1", "u1", "r3", second.id, "FAILED", "rec-b");

    expect(failed.sale.status).toBe("PAYMENT_FAILED");
    expect((failed.payment as DbPayment).status).toBe("FAILED");
    expect(effects()).toEqual({ stockApplications: 0, metered: 0 });
  });

  it("commits a linked WEB reservation once when UNKNOWN reconciliation succeeds", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Reconcile web", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Unit", sku: "U", barcode: null, brand: null,
      unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
      trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
    const now = new Date("2026-10-06T12:00:00.000Z");
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PREPAID",
      branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
      version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public", requestId: "rec-order", createdAt: now, updatedAt: now,
    });
    await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
      sku: product.sku, barcode: null, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 50,
      taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100, bundleComponentsSnapshot: null, createdAt: now,
    });
    await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "rec-hold", now);
    const sale = await new OrderSaleService(db).createSaleFromSubmittedOrder(business.id, "staff", "rec-sale", order.id);
    const outbox = createMemoryOrderNotificationOutbox();
    let outboundOrderUpdates = 0;
    const sales = new SalesService(db, undefined, {
      async sendPasswordReset() {},
      async sendEmailVerification() {},
      async sendReceiptShare() {},
      async sendOrderUpdate() { outboundOrderUpdates++; },
    }, outbox);
    const unknown = await sales.completeSale(business.id, "staff", "rec-unknown", sale.id, {
      payments: [{ method: "card", amountMinor: sale.totalMinor, providerRef: "unknown-rec" }],
      key: "rec-unknown-key", granted: [], branchId: branch.id,
    });
    expect(unknown.sale.status).toBe("PAYMENT_UNKNOWN");
    const payment = (await db.listPaymentsBySale(sale.id, business.id))[0]!;

    const done = await sales.reconcilePayment(business.id, "staff", "rec-ok", payment.id, "SUCCEEDED", "rec-ok-key");
    expect(done.sale.status).toBe("COMPLETED");
    expect(await db.findOrderById(order.id, business.id)).toMatchObject({ status: "CONFIRMED" });
    const reconciledFulfillments = await db.listFulfillmentsByOrder(order.id, business.id);
    expect(reconciledFulfillments).toHaveLength(1);
    expect(await db.listFulfillmentLines(reconciledFulfillments[0]!.id, business.id)).toEqual([
      expect.objectContaining({ qty: 1 }),
    ]);
    expect(await db.listReservationsByOrder(order.id, business.id)).toEqual([
      expect.objectContaining({ status: "COMMITTED", expiresAt: null }),
    ]);
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(0);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
    expect(await outbox.listForTests()).toEqual([
      expect.objectContaining({
        businessId: business.id, orderId: order.id, event: "CONFIRMED",
        status: "PENDING", attempts: 0,
      }),
    ]);
    expect(outboundOrderUpdates).toBe(0);

    await sales.reconcilePayment(business.id, "staff", "rec-replay", payment.id, "SUCCEEDED", "rec-ok-key");
    expect(await db.listFulfillmentsByOrder(order.id, business.id)).toHaveLength(1);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
    expect(await outbox.listForTests()).toHaveLength(1);
    expect(outboundOrderUpdates).toBe(0);
  });

  it("leaves a linked WEB reservation HELD when UNKNOWN reconciliation definitively fails", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Reconcile fail", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Unit", sku: "UF", barcode: null, brand: null,
      unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
      trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
    const now = new Date();
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PREPAID",
      branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
      version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public", requestId: "rec-fail-order", createdAt: now, updatedAt: now,
    });
    await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
      sku: product.sku, barcode: null, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 50,
      taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100, bundleComponentsSnapshot: null, createdAt: now,
    });
    await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "rec-fail-hold", now);
    const sale = await new OrderSaleService(db).createSaleFromSubmittedOrder(business.id, "staff", "rec-fail-sale", order.id);
    const sales = new SalesService(db);
    await sales.completeSale(business.id, "staff", "rec-fail-unknown", sale.id, {
      payments: [{ method: "card", amountMinor: sale.totalMinor, providerRef: "unknown-rec-fail" }],
      key: "rec-fail-unknown-key", granted: [], branchId: branch.id,
    });
    const payment = (await db.listPaymentsBySale(sale.id, business.id))[0]!;
    const failed = await sales.reconcilePayment(business.id, "staff", "rec-fail", payment.id, "FAILED", "rec-fail-key");
    expect(failed.sale.status).toBe("PAYMENT_FAILED");
    expect(await db.findOrderById(order.id, business.id)).toMatchObject({ status: "SUBMITTED" });
    expect(await db.listReservationsByOrder(order.id, business.id)).toEqual([
      expect.objectContaining({ status: "HELD" }),
    ]);
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(1);
  });
});

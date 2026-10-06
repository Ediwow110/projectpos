import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { OrderSaleService } from "../orders/order-sale-service";
import { FulfillmentService } from "../orders/fulfillment-service";
import { ReservationService } from "../orders/reservation-service";
import { SalesService } from "./nest/sales.service";

async function setupWebSale(opts: {
  hold?: boolean;
  fulfillmentMode?: "PICKUP" | "DELIVERY";
  paymentMode?: "PREPAID" | "PAY_AT_PICKUP";
} = { hold: true }) {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Web settle", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Reserved", sku: "R1", barcode: null, brand: null,
    unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
    trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
  const now = new Date("2026-10-06T12:00:00.000Z");
  const fulfillmentMode = opts.fulfillmentMode ?? "PICKUP";
  const paymentMode = opts.paymentMode ?? (fulfillmentMode === "PICKUP" ? "PAY_AT_PICKUP" : "PREPAID");
  const delivery = fulfillmentMode === "DELIVERY";
  const order = await db.createOrder({
    businessId: business.id, channel: "WEB", fulfillmentMode, paymentMode,
    branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: delivery ? { line1: "1 Main" } : null, fulfillmentInstructions: delivery ? "Leave at door" : null,
    currency: "PHP", subtotalMinor: 100, discountMinor: 0, taxMinor: 0,
    deliveryFeeMinor: delivery ? 20 : 0, deliveryTaxMinor: delivery ? 2 : 0,
    totalMinor: delivery ? 122 : 100, saleId: null, status: "SUBMITTED",
    version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
    actorId: "public", requestId: "web-order", createdAt: now, updatedAt: now,
  });
  await db.createOrderLine({
    businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
    sku: product.sku, barcode: null, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 50,
    taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100, bundleComponentsSnapshot: null,
    createdAt: now,
  });
  if (opts.hold !== false) {
    await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "web-hold", now);
  }
  const sale = await new OrderSaleService(db).createSaleFromSubmittedOrder(
    business.id, "staff", "web-sale", order.id,
  );
  return { db, business, branch, product, order, sale, sales: new SalesService(db) };
}

describe("phase22 reservation-aware Sale completion", () => {
  it("uses its own HELD stock, commits the reservation, and confirms the WEB Order exactly once", async () => {
    const { db, business, branch, product, order, sale, sales } = await setupWebSale();
    const first = await sales.completeSale(business.id, "cashier", "complete-web", sale.id, {
      payments: [{ method: "cash", amountMinor: sale.totalMinor }],
      key: "complete-web-key",
      granted: [],
      branchId: branch.id,
    });
    expect(first.sale.status).toBe("COMPLETED");
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(0);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
    expect(await db.listReservationsByOrder(order.id, business.id)).toEqual([
      expect.objectContaining({ status: "COMMITTED", expiresAt: null }),
    ]);
    expect(await db.findOrderById(order.id, business.id)).toMatchObject({ status: "CONFIRMED" });

    const replay = await sales.completeSale(business.id, "cashier", "complete-web-replay", sale.id, {
      payments: [{ method: "cash", amountMinor: sale.totalMinor }],
      key: "complete-web-key",
      granted: [],
      branchId: branch.id,
    });
    expect(replay.replayed).toBe(true);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
  });

  it("creates one full frozen-line fulfillment for prepaid pickup and delivery settlement", async () => {
    for (const fulfillmentMode of ["PICKUP", "DELIVERY"] as const) {
      const { db, business, branch, order, sale, sales } = await setupWebSale({
        fulfillmentMode,
        paymentMode: "PREPAID",
      });
      await sales.completeSale(business.id, "cashier", `complete-${fulfillmentMode}`, sale.id, {
        payments: [{ method: "cash", amountMinor: sale.totalMinor }],
        key: `complete-${fulfillmentMode}-key`, granted: [], branchId: branch.id,
      });

      const fulfillments = await db.listFulfillmentsByOrder(order.id, business.id);
      expect(fulfillments).toHaveLength(1);
      expect(fulfillments[0]).toMatchObject({
        type: fulfillmentMode,
        branchId: branch.id,
        deliveryAddress: fulfillmentMode === "DELIVERY" ? { line1: "1 Main" } : null,
      });
      expect(await db.listFulfillmentLines(fulfillments[0]!.id, business.id)).toEqual([
        expect.objectContaining({ orderLineId: expect.any(String), qty: 1 }),
      ]);

      await new FulfillmentService(db).ensureFulfillmentLocked(business.id, order.id);
      expect(await db.listFulfillmentsByOrder(order.id, business.id)).toHaveLength(1);
    }
  });

  it("rolls back stock and financial completion when linked WEB reservation coverage is missing", async () => {
    const { db, business, branch, product, order, sale, sales } = await setupWebSale({ hold: false });
    await expect(sales.completeSale(business.id, "cashier", "complete-no-hold", sale.id, {
      payments: [{ method: "cash", amountMinor: sale.totalMinor }],
      key: "complete-no-hold-key",
      granted: [],
      branchId: branch.id,
    })).rejects.toThrow("RESERVATION_CONFLICT");
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(1);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(0);
    expect((await db.findSaleById(sale.id, business.id))?.status).toBe("DRAFT");
    expect((await db.findOrderById(order.id, business.id))?.status).toBe("SUBMITTED");
  });

  it("keeps a WEB Order SUBMITTED and reservation HELD while payment is UNKNOWN", async () => {
    const { db, business, branch, product, order, sale, sales } = await setupWebSale();
    const pending = await sales.completeSale(business.id, "cashier", "unknown-web", sale.id, {
      payments: [{ method: "card", amountMinor: sale.totalMinor, providerRef: "unknown-web-provider" }],
      key: "unknown-web-key",
      granted: [],
      branchId: branch.id,
    });
    expect(pending.sale.status).toBe("PAYMENT_UNKNOWN");
    expect((await db.findOrderById(order.id, business.id))?.status).toBe("SUBMITTED");
    expect(await db.listReservationsByOrder(order.id, business.id)).toEqual([
      expect.objectContaining({ status: "HELD" }),
    ]);
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(1);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(0);
  });
});

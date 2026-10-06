import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/common/memory.db";
import { ReservationService } from "../src/orders/reservation-service";
import { OrderService } from "../src/orders/order-service";
import { OrderExpiryService } from "../src/orders/order-expiry-service";
import { DisabledPayMongo } from "../src/payments/paymongo";

async function setupLastUnit() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Race", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Last", sku: "LAST", barcode: null, brand: null,
    unit: "pc", costMinor: 10, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
    trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
  const makeOrder = async (suffix: string) => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
      branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
      version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public", requestId: "order-" + suffix, createdAt: now, updatedAt: now,
    });
    await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
      sku: product.sku, barcode: product.barcode, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 10,
      taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100, bundleComponentsSnapshot: null, createdAt: now,
    });
    return order;
  };
  return { db, business, product, makeOrder };
}

describe("phase22 reservation concurrency contract", () => {
  it("serializes two last-unit Order holds and creates no inventory movement", async () => {
    const { db, business, product, makeOrder } = await setupLastUnit();
    const [a, b] = await Promise.all([makeOrder("a"), makeOrder("b")]);
    const reservations = new ReservationService(db);
    const results = await Promise.allSettled([
      reservations.holdSubmittedOrder(business.id, a.id, "hold-a", new Date("2026-10-06T12:00:00.000Z")),
      reservations.holdSubmittedOrder(business.id, b.id, "hold-b", new Date("2026-10-06T12:00:00.000Z")),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
    expect((results.find((row) => row.status === "rejected") as PromiseRejectedResult).reason.message)
      .toBe("RESERVATION_CONFLICT");
    expect(await db.listMovements(product.id, business.id, null)).toEqual([]);
    expect((await db.listReservationsByOrder(a.id, business.id)).filter((row) => row.status === "HELD").length +
      (await db.listReservationsByOrder(b.id, business.id)).filter((row) => row.status === "HELD").length).toBe(1);
  });

  it("acceptance versus expiry produces exactly one coherent terminal outcome", async () => {
    const { db, business, makeOrder } = await setupLastUnit();
    const order = await makeOrder("accept-expire");
    const reservations = new ReservationService(db);
    const now = new Date("2026-10-06T12:00:00.000Z");
    await reservations.holdSubmittedOrder(business.id, order.id, "hold-race", now);
    const hold = (await db.listReservationsByOrder(order.id, business.id))[0]!;
    await db.updateInventoryReservation(hold.id, business.id, { expiresAt: now });
    const orders = new OrderService(db);
    const expiry = new OrderExpiryService(db, new DisabledPayMongo());
    await Promise.allSettled([
      orders.acceptPayAtPickup(business.id, "staff", "accept", order.id, order.version, "accept-key", now),
      expiry.sweep(now),
    ]);
    const finalOrder = (await db.findOrderById(order.id, business.id))!;
    const finalHold = (await db.listReservationsByOrder(order.id, business.id))[0]!;
    const coherent =
      (finalOrder.status === "CONFIRMED" && finalHold.status === "HELD" && finalHold.expiresAt === null)
      || (finalOrder.status === "EXPIRED" && finalHold.status === "EXPIRED");
    expect(coherent).toBe(true);
  });
});

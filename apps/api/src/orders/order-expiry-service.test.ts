import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import type { PayMongoCheckoutSnapshot, PayMongoPort } from "../payments/paymongo";
import { OrderExpiryService } from "./order-expiry-service";

class FakeProvider implements PayMongoPort {
  snapshot: PayMongoCheckoutSnapshot = { sessionId: "cs_1", checkoutUrl: "https://x", status: "active", paid: false };
  configured(): boolean { return true; }
  async createCheckout(): Promise<any> { throw new Error("unused"); }
  async retrieveCheckout(): Promise<PayMongoCheckoutSnapshot> { return this.snapshot; }
  verifyWebhook(): boolean { return true; }
}

async function dueFixture(linkSale: boolean) {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Expiry", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Unit", sku: "U", barcode: null, brand: null, unit: "pc",
    costMinor: 10, priceMinor: 100, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
  const now = new Date("2026-10-06T12:00:00.000Z");
  let saleId: string | null = null;
  if (linkSale) {
    const sale = await db.createSale({
      businessId: business.id, receiptNo: "R1", status: "PENDING_PAYMENT", subtotalMinor: 100, discountMinor: 0,
      taxMinor: 0, totalMinor: 100, paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: "Ana",
      notes: null, actorId: "public", requestId: "s", idempotencyKey: null, registerId: null, branchId: branch.id,
      completedAt: null, voidedAt: null, voidReason: null, createdAt: now,
    });
    saleId = sale.id;
    await db.createPayment({
      businessId: business.id, saleId: sale.id, method: "card", amountMinor: 100, status: "PENDING",
      providerRef: "cs_1", idempotencyKey: "p1",
    });
  }
  const order = await db.createOrder({
    businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: linkSale ? "PREPAID" : "PAY_AT_PICKUP",
    branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
    taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId, status: "SUBMITTED",
    version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
    actorId: "public", requestId: "o", createdAt: now, updatedAt: now,
  });
  const line = await db.createOrderLine({
    businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
    sku: product.sku, barcode: null, unit: "pc", qty: 1, priceMinor: 100, costMinor: 10, taxRateBps: null,
    discountMinor: 0, taxMinor: 0, lineTotalMinor: 100, bundleComponentsSnapshot: null, createdAt: now,
  });
  await db.createInventoryReservation({
    businessId: business.id, branchId: branch.id, orderId: order.id, orderLineId: line.id, productId: product.id,
    qty: 1, status: "HELD", expiresAt: new Date(now.getTime() - 1), idempotencyKey: "hold", createdAt: now, updatedAt: now,
  });
  return { db, business, order, now };
}

describe("phase22 Order expiry", () => {
  it("expires an ordinary timed hold exactly once", async () => {
    const { db, business, order, now } = await dueFixture(false);
    const svc = new OrderExpiryService(db, new FakeProvider());
    expect(await svc.sweep(now)).toBe(1);
    expect(await svc.sweep(now)).toBe(0);
    expect((await db.findOrderById(order.id, business.id))?.status).toBe("EXPIRED");
    expect((await db.listReservationsByOrder(order.id, business.id))[0]?.status).toBe("EXPIRED");
  });

  it("extends an active provider hold by five minutes", async () => {
    const { db, business, order, now } = await dueFixture(true);
    const provider = new FakeProvider();
    const svc = new OrderExpiryService(db, provider);
    expect(await svc.sweep(now)).toBe(0);
    const hold = (await db.listReservationsByOrder(order.id, business.id))[0]!;
    expect(hold.status).toBe("HELD");
    expect(hold.expiresAt?.getTime()).toBe(now.getTime() + 5 * 60_000);
  });

  it("expires only when the provider is definitively expired", async () => {
    const { db, business, order, now } = await dueFixture(true);
    const provider = new FakeProvider();
    provider.snapshot = { sessionId: "cs_1", checkoutUrl: null, status: "expired", paid: false };
    const svc = new OrderExpiryService(db, provider);
    expect(await svc.sweep(now)).toBe(1);
    expect((await db.findOrderById(order.id, business.id))?.status).toBe("EXPIRED");
  });
});

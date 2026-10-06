import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { OrderService } from "./order-service";
import { OrderSaleService } from "./order-sale-service";
import { ReservationService } from "./reservation-service";
import { SalesService } from "../sales/nest/sales.service";

async function seedOrder(
  db: ReturnType<typeof createMemoryDb>,
  businessId: string,
  createdAt: Date,
  branchId: string,
) {
  const order = await db.createOrder({
    businessId, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
    taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
    version: 1, checkoutAt: createdAt, submittedAt: createdAt, confirmedAt: null, completedAt: null, cancelledAt: null,
    actorId: "u1", requestId: "r1", createdAt, updatedAt: createdAt,
  });
  return order;
}

describe("phase22 order service reads", () => {
  it("delegates bounded filtering/pagination to listOrdersPage and emits stable cursor", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Store", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const spy = vi.spyOn(db, "listOrdersPage");
    const svc = new OrderService(db);
    for (let i = 0; i < 3; i += 1) await seedOrder(db, business.id, new Date(1_700_000_000_000 + i), branch.id);

    const first = await svc.listOrders(business.id, { limit: 2, branchId: branch.id });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    expect(spy).toHaveBeenCalledWith(business.id, expect.objectContaining({ limit: 3, branchId: branch.id }));
    const second = await svc.listOrders(business.id, { limit: 2, branchId: branch.id, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(3);
  });

  it("validates max limit/date range and tenant branch", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Store", currency: "PHP" });
    const other = await db.createBusiness({ name: "Other", currency: "PHP" });
    const foreign = await db.createBranch({ businessId: other.id, name: "Foreign", type: "store", isActive: true });
    const svc = new OrderService(db);
    await expect(svc.listOrders(business.id, { limit: 101 })).rejects.toThrow("VALIDATION");
    await expect(svc.listOrders(business.id, {
      limit: 50,
      dateFrom: "2025-01-01T00:00:00.000Z",
      dateTo: "2026-12-31T00:00:00.000Z",
    })).rejects.toThrow("VALIDATION");
    await expect(svc.listOrders(business.id, { limit: 50, branchId: foreign.id })).rejects.toThrow("VALIDATION");
  });

  it("redacts contact channels and delivery details without the delivery permission", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Store", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const order = await seedOrder(db, business.id, new Date(), branch.id);
    await db.updateOrder(order.id, business.id, {
      deliveryAddress: { line1: "Secret" },
      fulfillmentInstructions: "Gate code",
    }, order.version);
    const svc = new OrderService(db);
    const redacted = await svc.getOrder(business.id, order.id, ["order.view"]);
    expect(redacted.order.email).toBeNull();
    expect(redacted.order.phone).toBeNull();
    expect(redacted.order.deliveryAddress).toBeNull();
    expect(redacted.order.fulfillmentInstructions).toBeNull();
    const full = await svc.getOrder(business.id, order.id, ["order.view_delivery_details"]);
    expect(full.order.email).toBe("ana@example.com");
    expect(full.order.deliveryAddress).toEqual({ line1: "Secret" });
  });
});

describe("phase22 order staff lifecycle", () => {
  it("keeps acceptance committed when notification delivery returns false", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Store", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Pickup", sku: "P", barcode: null, brand: null,
      unit: "pc", costMinor: 10, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
      trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 2 });
    const now = new Date();
    const order = await seedOrder(db, business.id, now, branch.id);
    await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
      sku: product.sku, barcode: null, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 10,
      taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100,
      bundleComponentsSnapshot: null, createdAt: now,
    });
    await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "accept-notify-hold", now);
    const sendEvent = vi.fn().mockResolvedValue(false);
    const service = new OrderService(db, { sendEvent } as never);
    const accepted = await service.acceptPayAtPickup(
      business.id,
      "staff",
      "accept-notify",
      order.id,
      order.version,
      "accept-notify-key",
      now,
    );
    expect(accepted.status).toBe("CONFIRMED");
    expect(sendEvent).toHaveBeenCalledWith(business.id, order.id, "CONFIRMED");
    expect((await db.listReservationsByOrder(order.id, business.id))[0]?.expiresAt).toBeNull();
    const acceptedFulfillments = await db.listFulfillmentsByOrder(order.id, business.id);
    expect(acceptedFulfillments).toHaveLength(1);
    expect(await db.listFulfillmentLines(acceptedFulfillments[0]!.id, business.id)).toEqual([
      expect.objectContaining({ qty: 1 }),
    ]);

    const sale = await new OrderSaleService(db).createSaleFromSubmittedOrder(
      business.id, "staff", "accept-sale", order.id,
    );
    await new SalesService(db).completeSale(business.id, "staff", "accept-complete", sale.id, {
      payments: [{ method: "cash", amountMinor: sale.totalMinor }],
      key: "accept-complete-key", granted: [], branchId: branch.id,
    });
    expect(await db.listFulfillmentsByOrder(order.id, business.id)).toHaveLength(1);
  });

  it("does not cancel a confirmed order while linked payment outcome is unknown", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Store", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const now = new Date();
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
      branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "CONFIRMED",
      version: 1, checkoutAt: now, submittedAt: now, confirmedAt: now, completedAt: null, cancelledAt: null,
      actorId: "u1", requestId: "r1", createdAt: now, updatedAt: now,
    });
    const sale = await db.createSale({
      businessId: business.id, receiptNo: "UNKNOWN-1", status: "PAYMENT_UNKNOWN",
      subtotalMinor: 100, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0,
      totalMinor: 100, paidMinor: 100, changeMinor: 0, currency: "PHP", customerId: null, customerName: "Ana",
      notes: null, actorId: "u1", requestId: "r2", idempotencyKey: null, registerId: null, branchId: branch.id,
      createdAt: now, completedAt: null,
    });
    const linked = await db.updateOrder(order.id, business.id, { saleId: sale.id }, order.version);
    expect(linked).toBeTruthy();
    await expect(new OrderService(db).cancelOrder(
      business.id,
      "staff",
      "cancel-unknown",
      order.id,
      linked!.version,
      "cancel-unknown-key",
      "Customer changed mind",
    )).rejects.toThrow("FULL_REFUND_REQUIRED");
  });
});

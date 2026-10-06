import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { FulfillmentService } from "./fulfillment-service";

async function fixture(type: "PICKUP" | "DELIVERY" = "PICKUP", qty = 2) {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Fulfillment", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Unit", sku: "U", barcode: null, brand: null,
    unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
    trackInventory: true, isActive: true, imageUrl: null,
  });
  const now = new Date("2026-10-06T12:00:00.000Z");
  const order = await db.createOrder({
    businessId: business.id, channel: "WEB", fulfillmentMode: type, paymentMode: type === "PICKUP" ? "PAY_AT_PICKUP" : "PREPAID",
    branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: type === "DELIVERY" ? { line1: "1 Main" } : null, fulfillmentInstructions: null,
    currency: "PHP", subtotalMinor: qty * 100, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0,
    deliveryTaxMinor: 0, totalMinor: qty * 100, saleId: null, status: "CONFIRMED", version: 1,
    checkoutAt: now, submittedAt: now, confirmedAt: now, completedAt: null, cancelledAt: null,
    actorId: "staff", requestId: "f", createdAt: now, updatedAt: now,
  });
  const line = await db.createOrderLine({
    businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
    sku: product.sku, barcode: null, unit: product.unit, qty, priceMinor: 100, costMinor: 50,
    taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: qty * 100,
    bundleComponentsSnapshot: null, createdAt: now,
  });
  return { db, business, branch, product, order, line, service: new FulfillmentService(db) };
}

describe("phase22 fulfillment workflow", () => {
  it("cancels pickup PENDING and delivery PENDING/PACKED before handoff", async () => {
    const pickup = await fixture("PICKUP", 1);
    const pickupPending = await pickup.service.createFulfillment(
      pickup.business.id,
      pickup.order.id,
      "PICKUP",
      pickup.branch.id,
      [{ orderLineId: pickup.line.id, qty: 1 }],
    );
    expect((await pickup.service.cancelFulfillment(
      pickup.business.id,
      "u1",
      "pickup-pending-cancel",
      pickup.order.id,
      pickupPending.id,
      pickupPending.version,
      "pickup-pending-cancel-key",
      false,
    )).status).toBe("CANCELLED");

    const deliveryPendingFixture = await fixture("DELIVERY", 1);
    const deliveryPending = await deliveryPendingFixture.service.createFulfillment(
      deliveryPendingFixture.business.id,
      deliveryPendingFixture.order.id,
      "DELIVERY",
      deliveryPendingFixture.branch.id,
      [{ orderLineId: deliveryPendingFixture.line.id, qty: 1 }],
    );
    expect((await deliveryPendingFixture.service.cancelFulfillment(
      deliveryPendingFixture.business.id,
      "u1",
      "delivery-pending-cancel",
      deliveryPendingFixture.order.id,
      deliveryPending.id,
      deliveryPending.version,
      "delivery-pending-cancel-key",
      false,
    )).status).toBe("CANCELLED");

    const deliveryPackedFixture = await fixture("DELIVERY", 1);
    const deliveryPacked = await deliveryPackedFixture.service.createFulfillment(
      deliveryPackedFixture.business.id,
      deliveryPackedFixture.order.id,
      "DELIVERY",
      deliveryPackedFixture.branch.id,
      [{ orderLineId: deliveryPackedFixture.line.id, qty: 1 }],
    );
    const packed = await deliveryPackedFixture.service.transition(
      deliveryPackedFixture.business.id,
      "u1",
      "pack-before-cancel",
      deliveryPackedFixture.order.id,
      deliveryPacked.id,
      "PACKED",
      deliveryPacked.version,
      "pack-before-cancel-key",
    );
    expect((await deliveryPackedFixture.service.cancelFulfillment(
      deliveryPackedFixture.business.id,
      "u1",
      "delivery-packed-cancel",
      deliveryPackedFixture.order.id,
      deliveryPacked.id,
      packed.version,
      "delivery-packed-cancel-key",
      false,
    )).status).toBe("CANCELLED");
  });

  it("supports pickup ready/cancel and rejects cancellation after collection", async () => {
    const { business, branch, order, line, service } = await fixture("PICKUP", 1);
    const f = await service.createFulfillment(business.id, order.id, "PICKUP", branch.id, [{ orderLineId: line.id, qty: 1 }]);
    const ready = await service.transition(business.id, "u1", "r1", order.id, f.id, "READY", f.version, "ready-1");
    expect(ready.status).toBe("READY");
    const cancelled = await service.cancelFulfillment(business.id, "u1", "r2", order.id, f.id, ready.version, "cancel-1", false);
    expect(cancelled.status).toBe("CANCELLED");

    const f2 = await service.createFulfillment(business.id, order.id, "PICKUP", branch.id, [{ orderLineId: line.id, qty: 1 }]);
    const ready2 = await service.transition(business.id, "u1", "r3", order.id, f2.id, "READY", f2.version, "ready-2");
    const collected = await service.transition(business.id, "u1", "r4", order.id, f2.id, "COLLECTED", ready2.version, "collect-2");
    expect(collected.status).toBe("COLLECTED");
    await expect(service.cancelFulfillment(business.id, "u1", "r5", order.id, f2.id, collected.version, "cancel-2", false))
      .rejects.toThrow("INVALID_STATE");
  });

  it("enforces delivery failure/custody cancellation and retry dispatch", async () => {
    const { business, branch, order, line, service } = await fixture("DELIVERY", 1);
    const f = await service.createFulfillment(business.id, order.id, "DELIVERY", branch.id, [{ orderLineId: line.id, qty: 1 }]);
    const packed = await service.transition(business.id, "u1", "r1", order.id, f.id, "PACKED", f.version, "pack");
    const dispatched = await service.transition(business.id, "u1", "r2", order.id, f.id, "DISPATCHED", packed.version, "dispatch");
    await expect(service.cancelFulfillment(business.id, "u1", "r3", order.id, f.id, dispatched.version, "bad-cancel", true))
      .rejects.toThrow("INVALID_STATE");
    const failed = await service.transition(business.id, "u1", "r4", order.id, f.id, "DELIVERY_FAILED", dispatched.version, "fail");
    await expect(service.cancelFulfillment(business.id, "u1", "r5", order.id, f.id, failed.version, "no-custody", false))
      .rejects.toThrow("VALIDATION");
    const retry = await service.transition(business.id, "u1", "r6", order.id, f.id, "DISPATCHED", failed.version, "redispatch");
    expect(retry.status).toBe("DISPATCHED");
  });

  it("allows DELIVERY_FAILED cancellation only after returned custody and rejects cancellation after delivery", async () => {
    const returned = await fixture("DELIVERY", 1);
    const f = await returned.service.createFulfillment(
      returned.business.id,
      returned.order.id,
      "DELIVERY",
      returned.branch.id,
      [{ orderLineId: returned.line.id, qty: 1 }],
    );
    const packed = await returned.service.transition(returned.business.id, "u1", "r1", returned.order.id, f.id, "PACKED", f.version, "pack-return");
    const dispatched = await returned.service.transition(returned.business.id, "u1", "r2", returned.order.id, f.id, "DISPATCHED", packed.version, "dispatch-return");
    const failed = await returned.service.transition(returned.business.id, "u1", "r3", returned.order.id, f.id, "DELIVERY_FAILED", dispatched.version, "fail-return");
    const cancelled = await returned.service.cancelFulfillment(
      returned.business.id,
      "u1",
      "r4",
      returned.order.id,
      f.id,
      failed.version,
      "cancel-returned",
      true,
    );
    expect(cancelled.status).toBe("CANCELLED");

    const deliveredFixture = await fixture("DELIVERY", 1);
    const deliveredF = await deliveredFixture.service.createFulfillment(
      deliveredFixture.business.id,
      deliveredFixture.order.id,
      "DELIVERY",
      deliveredFixture.branch.id,
      [{ orderLineId: deliveredFixture.line.id, qty: 1 }],
    );
    const deliveredPacked = await deliveredFixture.service.transition(deliveredFixture.business.id, "u1", "d1", deliveredFixture.order.id, deliveredF.id, "PACKED", deliveredF.version, "d-pack");
    const deliveredDispatched = await deliveredFixture.service.transition(deliveredFixture.business.id, "u1", "d2", deliveredFixture.order.id, deliveredF.id, "DISPATCHED", deliveredPacked.version, "d-dispatch");
    const delivered = await deliveredFixture.service.transition(deliveredFixture.business.id, "u1", "d3", deliveredFixture.order.id, deliveredF.id, "DELIVERED", deliveredDispatched.version, "d-deliver");
    await expect(deliveredFixture.service.cancelFulfillment(
      deliveredFixture.business.id,
      "u1",
      "d4",
      deliveredFixture.order.id,
      deliveredF.id,
      delivered.version,
      "d-cancel",
      true,
    )).rejects.toThrow("INVALID_STATE");
  });

  it("supports partial fulfillment allocation and completes only after every unit is handed off", async () => {
    const { db, business, branch, order, line, service } = await fixture("PICKUP", 2);
    const a = await service.createFulfillment(business.id, order.id, "PICKUP", branch.id, [{ orderLineId: line.id, qty: 1 }]);
    const b = await service.createFulfillment(business.id, order.id, "PICKUP", branch.id, [{ orderLineId: line.id, qty: 1 }]);
    await expect(service.createFulfillment(business.id, order.id, "PICKUP", branch.id, [{ orderLineId: line.id, qty: 1 }]))
      .rejects.toThrow("FULFILLMENT_OVERALLOCATED");
    const ar = await service.transition(business.id, "u1", "a1", order.id, a.id, "READY", a.version, "a-ready");
    await service.transition(business.id, "u1", "a2", order.id, a.id, "COLLECTED", ar.version, "a-collect");
    expect((await db.findOrderById(order.id, business.id))?.status).toBe("CONFIRMED");
    const br = await service.transition(business.id, "u1", "b1", order.id, b.id, "READY", b.version, "b-ready");
    await service.transition(business.id, "u1", "b2", order.id, b.id, "COLLECTED", br.version, "b-collect");
    expect((await db.findOrderById(order.id, business.id))?.status).toBe("COMPLETED");
  });

  it("validates fulfillment assignment against an active same-business membership", async () => {
    const { db, business, branch, order, line, service } = await fixture("PICKUP", 1);
    const other = await db.createBusiness({ name: "Other", currency: "PHP" });
    const user = await db.createUser({ name: "Staff", email: "staff@example.com", passwordHash: "x", emailVerified: true });
    await db.createMembership({ businessId: other.id, userId: user.id, role: "cashier" });
    const f = await service.createFulfillment(business.id, order.id, "PICKUP", branch.id, [{ orderLineId: line.id, qty: 1 }]);
    await expect(service.assignFulfillment(business.id, "owner", "r1", order.id, f.id, user.id, f.version, "assign-x"))
      .rejects.toThrow("VALIDATION");
    await db.createMembership({ businessId: business.id, userId: user.id, role: "inventory" });
    const assigned = await service.assignFulfillment(business.id, "owner", "r2", order.id, f.id, user.id, f.version, "assign-ok");
    expect(assigned.assignedUserId).toBe(user.id);
  });
});

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";

function orderInput(businessId: string, branchId: string) {
  const now = new Date("2026-10-06T12:00:00.000Z");
  return {
    businessId,
    channel: "WEB",
    fulfillmentMode: "PICKUP",
    paymentMode: "PREPAID",
    branchId,
    customerId: null,
    contactName: "Ana Reyes",
    email: "ana@example.com",
    phone: "+639171234567",
    deliveryAddress: null,
    fulfillmentInstructions: null,
    currency: "PHP",
    subtotalMinor: 1000,
    discountMinor: 0,
    taxMinor: 120,
    deliveryFeeMinor: 0,
    deliveryTaxMinor: 0,
    totalMinor: 1120,
    saleId: null,
    status: "SUBMITTED",
    version: 1,
    checkoutAt: now,
    submittedAt: now,
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    actorId: "public:test",
    requestId: "req-order-1",
    createdAt: now,
    updatedAt: now,
  };
}

describe("phase22 memory order persistence", () => {
  it("stores order rows, lines, reservations, fulfillments and access tokens", async () => {
    const db = createMemoryDb() as any;
    const business = await db.createBusiness({ name: "Memory Store", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const product = await db.createProduct({
      businessId: business.id,
      categoryId: null,
      name: "Coffee",
      sku: "COF-1",
      barcode: null,
      brand: null,
      unit: "pc",
      costMinor: 500,
      priceMinor: 1000,
      taxRateBps: 1200,
      reorderLevel: 0,
      trackInventory: true,
      isActive: true,
      imageUrl: null,
    });

    const order = await db.createOrder(orderInput(business.id, branch.id));
    const line = await db.createOrderLine({
      businessId: business.id,
      orderId: order.id,
      position: 0,
      productId: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      unit: product.unit,
      qty: 1,
      priceMinor: 1000,
      costMinor: 500,
      taxRateBps: 1200,
      discountMinor: 0,
      taxMinor: 120,
      lineTotalMinor: 1120,
      bundleComponentsSnapshot: [{ componentProductId: product.id, componentNameSnapshot: "Coffee", quantityPerBundleSnapshot: 1, costMinorSnapshot: 500, compositionVersion: 1 }],
      createdAt: order.createdAt,
    });
    const reservation = await db.createInventoryReservation({
      businessId: business.id,
      branchId: branch.id,
      orderId: order.id,
      orderLineId: line.id,
      productId: product.id,
      qty: 1,
      status: "HELD",
      expiresAt: null,
      idempotencyKey: "hold:order-1:line-1",
      createdAt: order.createdAt,
      updatedAt: order.createdAt,
    });
    const fulfillment = await db.createFulfillment({
      businessId: business.id,
      orderId: order.id,
      type: "PICKUP",
      status: "PENDING",
      branchId: branch.id,
      assignedUserId: null,
      contactName: order.contactName,
      email: order.email,
      phone: order.phone,
      deliveryAddress: null,
      instructions: null,
      version: 1,
      readyAt: null,
      dispatchedAt: null,
      deliveredAt: null,
      collectedAt: null,
      failedAt: null,
      cancelledAt: null,
      createdAt: order.createdAt,
      updatedAt: order.createdAt,
    });
    const allocation = await db.createFulfillmentLine({
      businessId: business.id,
      fulfillmentId: fulfillment.id,
      orderLineId: line.id,
      qty: 1,
      createdAt: order.createdAt,
    });
    const token = await db.createOrderAccessToken({
      businessId: business.id,
      orderId: order.id,
      kind: "STATUS",
      tokenHash: "a".repeat(64),
      expiresAt: new Date("2026-11-05T12:00:00.000Z"),
      revokedAt: null,
      createdAt: order.createdAt,
    });

    expect(await db.findOrderById(order.id, business.id)).toEqual(order);
    expect(await db.listOrderLines(order.id, business.id)).toEqual([line]);
    expect(await db.listReservationsByOrder(order.id, business.id)).toEqual([reservation]);
    expect(await db.listFulfillmentsByOrder(order.id, business.id)).toEqual([fulfillment]);
    expect(await db.listFulfillmentLines(fulfillment.id, business.id)).toEqual([allocation]);
    expect(await db.findOrderAccessTokenByHash(token.tokenHash)).toEqual(token);

    const revokedAt = new Date("2026-10-07T12:00:00.000Z");
    expect(await db.revokeOrderAccessToken(token.id, business.id, revokedAt)).toEqual({ ...token, revokedAt });
  });
});

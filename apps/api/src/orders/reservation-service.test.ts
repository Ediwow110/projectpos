import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { InventoryAvailabilityService } from "../inventory/availability-service";
import { ReservationService } from "./reservation-service";

async function fixture(qtyOnHand = 1) {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Reservations", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Unit", sku: "U", barcode: null, brand: null,
    unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
    trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand });
  const makeOrder = async (suffix: string, productId = product.id, bundleSnapshot: unknown = null) => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
      branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
      version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public:test", requestId: "order-" + suffix, createdAt: now, updatedAt: now,
    });
    const line = await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId, name: "Unit", sku: null, barcode: null,
      unit: "pc", qty: 1, priceMinor: 100, costMinor: 50, taxRateBps: null, discountMinor: 0, taxMinor: 0,
      lineTotalMinor: 100, bundleComponentsSnapshot: bundleSnapshot, createdAt: now,
    });
    return { order, line };
  };
  return { db, business, branch, product, makeOrder };
}

describe("phase22 reservation service", () => {
  it("allows exactly one last-unit HELD reservation", async () => {
    const { db, business, makeOrder } = await fixture(1);
    const a = await makeOrder("a");
    const b = await makeOrder("b");
    const service = new ReservationService(db);
    const now = new Date();
    const [one, two] = await Promise.allSettled([
      service.holdSubmittedOrder(business.id, a.order.id, "hold-a", now),
      service.holdSubmittedOrder(business.id, b.order.id, "hold-b", now),
    ]);
    expect([one.status, two.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = one.status === "rejected" ? one.reason : two.status === "rejected" ? two.reason : null;
    expect(String(rejected)).toContain("RESERVATION_CONFLICT");
  });

  it("excludes the owner hold from ATS but preserves other Orders", async () => {
    const { db, business, branch, product, makeOrder } = await fixture(2);
    const owner = await makeOrder("owner");
    const other = await makeOrder("other");
    const reservations = new ReservationService(db);
    await reservations.holdSubmittedOrder(business.id, owner.order.id, "hold-owner", new Date());
    await reservations.holdSubmittedOrder(business.id, other.order.id, "hold-other", new Date());
    const availability = new InventoryAvailabilityService(db);
    expect(await availability.availableToSell(business.id, branch.id, product.id)).toBe(0);
    expect(await availability.availableToSell(business.id, branch.id, product.id, owner.order.id)).toBe(1);
    await expect(availability.assertDecreaseAllowed(
      business.id, branch.id, [{ productId: product.id, qty: 2 }], owner.order.id,
    )).rejects.toThrow("RESERVATION_CONFLICT");
  });

  it("expands bundle snapshots once and release/expiry restores ATS without movement", async () => {
    const { db, business, branch, product, makeOrder } = await fixture(4);
    const bundle = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Bundle", sku: "KIT", barcode: null, brand: null,
      unit: "kit", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0,
      trackInventory: false, isActive: true, imageUrl: null, productType: "BUNDLE",
    });
    const snapshot = [{
      componentProductId: product.id, componentNameSnapshot: product.name,
      quantityPerBundleSnapshot: 2, costMinorSnapshot: product.costMinor, compositionVersion: 1,
    }];
    const { order } = await makeOrder("bundle", bundle.id, snapshot);
    const service = new ReservationService(db);
    const held = await service.holdSubmittedOrder(business.id, order.id, "hold-bundle", new Date());
    expect(held).toHaveLength(1);
    expect(held[0]?.productId).toBe(product.id);
    expect(held[0]?.qty).toBe(2);
    expect(await new InventoryAvailabilityService(db).availableToSell(business.id, branch.id, product.id)).toBe(2);
    const movementsBefore = await db.listMovementsByBusiness(business.id);
    await service.releaseOrder(business.id, order.id, "RELEASED");
    expect(await new InventoryAvailabilityService(db).availableToSell(business.id, branch.id, product.id)).toBe(4);
    expect(await db.listMovementsByBusiness(business.id)).toEqual(movementsBefore);
  });
});

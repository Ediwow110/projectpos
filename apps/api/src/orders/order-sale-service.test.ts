import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { OrderSaleService } from "./order-sale-service";

describe("phase22 Order/Sale linking", () => {
  it("creates a WEB Sale from frozen Order snapshots instead of live catalog data", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Frozen", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const component = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Frozen component", sku: "C1", barcode: null, brand: null,
      unit: "pc", costMinor: 75, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
      trackInventory: true, isActive: true, imageUrl: null,
    });
    const bundleProduct = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Live bundle", sku: "B1", barcode: "123", brand: null,
      unit: "kit", costMinor: 150, priceMinor: 900, taxRateBps: 1200, reorderLevel: 0,
      trackInventory: false, isActive: true, imageUrl: null, productType: "BUNDLE",
    });
    const bundle = await db.createProductBundle({ businessId: business.id, bundleProductId: bundleProduct.id, version: 1 });
    await db.createBundleComponent({
      businessId: business.id, bundleId: bundle.id, componentProductId: component.id, quantity: 2, position: 0,
    });
    const customer = await db.createCustomer({
      businessId: business.id, name: "Linked CRM", phone: "+639171111111", email: "crm@example.com",
      address: null, notes: null, isActive: true,
    });
    const now = new Date("2026-10-06T12:00:00.000Z");
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PREPAID",
      branchId: branch.id, customerId: customer.id, contactName: "Guest Snapshot", email: "guest@example.com",
      phone: "+639172222222", deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP",
      subtotalMinor: 700, discountMinor: 100, taxMinor: 72, deliveryFeeMinor: 50, deliveryTaxMinor: 6,
      totalMinor: 728, saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now,
      confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public", requestId: "order-frozen",
      createdAt: now, updatedAt: now,
    });
    const line = await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId: bundleProduct.id,
      name: "Frozen bundle name", sku: "FROZEN-SKU", barcode: "999", unit: "set", qty: 1,
      priceMinor: 700, costMinor: 150, taxRateBps: 1200, discountMinor: 100, taxMinor: 72,
      lineTotalMinor: 600,
      bundleComponentsSnapshot: [{
        bundleId: bundle.id,
        componentProductId: component.id,
        componentNameSnapshot: "Frozen component name",
        quantityPerBundleSnapshot: 2,
        costMinorSnapshot: 75,
        compositionVersion: 1,
      }],
      createdAt: now,
    });
    await db.updateProduct(bundleProduct.id, business.id, { name: "Changed live bundle", priceMinor: 5000, costMinor: 999 });
    await db.updateProduct(component.id, business.id, { name: "Changed component", costMinor: 999 });
    await db.deleteBundleComponents(bundle.id, business.id);

    const service = new OrderSaleService(db);
    const sale = await service.createSaleFromSubmittedOrder(business.id, "staff", "sale-from-order", order.id);
    const item = (await db.listSaleItems(sale.id, business.id))[0]!;
    const components = await db.listSaleItemBundleComponents(item.id, business.id);

    expect(sale).toMatchObject({
      subtotalMinor: 700, discountMinor: 100, taxMinor: 72,
      deliveryFeeMinor: 50, deliveryTaxMinor: 6, totalMinor: 728,
      branchId: branch.id, customerId: null, customerName: "Guest Snapshot",
    });
    expect(item).toMatchObject({
      productId: line.productId, name: "Frozen bundle name", unit: "set",
      qty: 1, priceMinor: 700, costMinor: 150, taxRateBps: 1200,
      lineDiscountMinor: 100, lineTotalMinor: 600,
    });
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
      bundleId: bundle.id,
      componentProductId: component.id,
      componentNameSnapshot: "Frozen component name",
      quantityPerBundleSnapshot: 2,
      costMinorSnapshot: 75,
      compositionVersion: 1,
    });
    expect((await db.findOrderById(order.id, business.id))?.saleId).toBe(sale.id);
  });

  it("creates only one POS companion Order and tolerates historical Sale-only rows", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "POS", currency: "PHP" });
    const sale = await db.createSale({
      businessId: business.id, receiptNo: "2026-000001", status: "DRAFT",
      subtotalMinor: 100, discountMinor: 0, taxMinor: 0, totalMinor: 100, paidMinor: 0, changeMinor: 0,
      currency: "PHP", customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "r1",
      idempotencyKey: null, registerId: null, branchId: null, createdAt: new Date(),
    });
    await db.createSaleItem({
      businessId: business.id, saleId: sale.id, productId: "p-legacy", name: "Legacy item", unit: "pc",
      qty: 1, priceMinor: 100, costMinor: 50, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 100,
    });
    const service = new OrderSaleService(db);
    const first = await service.createPosOrderForSale(business.id, "u1", "pos-order", sale.id);
    const replay = await service.createPosOrderForSale(business.id, "u1", "pos-order-replay", sale.id);
    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      channel: "POS", fulfillmentMode: "NONE", paymentMode: "POS", status: "CONFIRMED", saleId: sale.id,
    });

    const historical = await db.createSale({
      businessId: business.id, receiptNo: "2026-000002", status: "COMPLETED",
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, paidMinor: 0, changeMinor: 0,
      currency: "PHP", customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "legacy",
      idempotencyKey: null, registerId: null, branchId: null, completedAt: new Date(), createdAt: new Date(),
    });
    expect(await db.findOrderBySaleId(historical.id, business.id)).toBeNull();
    expect(await db.findSaleById(historical.id, business.id)).toEqual(historical);
  });
});

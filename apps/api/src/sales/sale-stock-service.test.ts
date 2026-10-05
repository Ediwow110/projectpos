import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../common/memory.db";
import { SalesStockService } from "./sale-stock-service";

describe("sales stock locking", () => {
  it("protects another Order's hold and lets the owning Sale consume its own hold", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Held", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const product = await db.createProduct({ businessId: business.id, categoryId: null, name: "Held unit", sku: "H", barcode: null, brand: null, unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
    const now = new Date();
    const order = await db.createOrder({ businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PREPAID", branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567", deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public", requestId: "o1", createdAt: now, updatedAt: now });
    const line = await db.createOrderLine({ businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name, sku: product.sku, barcode: null, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 50, taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100, bundleComponentsSnapshot: null, createdAt: now });
    await db.createInventoryReservation({ businessId: business.id, branchId: branch.id, orderId: order.id, orderLineId: line.id, productId: product.id, qty: 1, status: "HELD", expiresAt: new Date(Date.now() + 60_000), idempotencyKey: "hold-1", createdAt: now, updatedAt: now });
    const sale = await db.createSale({ businessId: business.id, receiptNo: "HOLD-1", status: "DRAFT", subtotalMinor: 100, discountMinor: 0, taxMinor: 0, totalMinor: 100, paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "s1", idempotencyKey: null, registerId: null, branchId: branch.id, createdAt: now });
    const item = await db.createSaleItem({ businessId: business.id, saleId: sale.id, productId: product.id, name: product.name, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 50, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 100 });
    const stock = new SalesStockService(db);
    await expect(stock.applySale(business.id, "u1", "r1", sale.id, [item], branch.id)).rejects.toThrow("RESERVATION_CONFLICT");
    await expect(stock.applySale(business.id, "u1", "r2", sale.id, [item], branch.id, order.id)).resolves.toBeUndefined();
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(0);
  });
  it("waits for the canonical branch/product inventory lock before mutating stock", async () => {
    const db = createMemoryDb();
    const product = await db.createProduct({
      businessId: "b1",
      categoryId: null,
      name: "Locked stock",
      sku: null,
      barcode: null,
      brand: null,
      unit: "pc",
      costMinor: 100,
      priceMinor: 200,
      taxRateBps: null,
      reorderLevel: 0,
      trackInventory: true,
      isActive: true,
      imageUrl: null,
    });
    await db.upsertBalance({
      businessId: "b1",
      productId: product.id,
      branchId: null,
      qtyOnHand: 10,
    });
    const sale = await db.createSale({
      businessId: "b1",
      receiptNo: "2026-000001",
      status: "DRAFT",
      subtotalMinor: 200,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 200,
      paidMinor: 0,
      changeMinor: 0,
      currency: "PHP",
      customerId: null,
      customerName: null,
      notes: null,
      actorId: "u1",
      requestId: "r1",
      idempotencyKey: null,
      registerId: null,
      branchId: null,
      createdAt: new Date(),
    });
    const item = await db.createSaleItem({
      businessId: "b1",
      saleId: sale.id,
      productId: product.id,
      name: product.name,
      unit: product.unit,
      qty: 1,
      priceMinor: product.priceMinor,
      costMinor: product.costMinor,
      taxRateBps: null,
      lineDiscountMinor: 0,
      lineTotalMinor: product.priceMinor,
    });
    const stock = new SalesStockService(db);
    const key = `b1::${product.id}`;
    let settled = false;

    await db.withLock(key, async () => {
      const applying = stock
        .applySale("b1", "u1", "r2", sale.id, [item], null)
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      void applying;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await db.findBalance(product.id, "b1", null))?.qtyOnHand).toBe(9);
  });

  it("decrements bundle components atomically and never creates bundle stock", async () => {
    const db = createMemoryDb();
    const component = await db.createProduct({ businessId: "b1", categoryId: null, name: "Bottle", sku: "B", barcode: null, brand: null, unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    const bundleProduct = await db.createProduct({ businessId: "b1", categoryId: null, name: "Six pack", sku: "PACK", barcode: null, brand: null, unit: "kit", costMinor: 300, priceMinor: 600, taxRateBps: null, reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null, productType: "BUNDLE" });
    const bundle = await db.createProductBundle({ businessId: "b1", bundleProductId: bundleProduct.id, version: 1 });
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: component.id, quantity: 2, position: 0 });
    await db.upsertBalance({ businessId: "b1", productId: component.id, branchId: null, qtyOnHand: 5 });
    const sale = await db.createSale({ businessId: "b1", receiptNo: "2026-000002", status: "DRAFT", subtotalMinor: 600, discountMinor: 0, taxMinor: 0, totalMinor: 600, paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "r1", idempotencyKey: null, registerId: null, branchId: null, createdAt: new Date() });
    const item = await db.createSaleItem({ businessId: "b1", saleId: sale.id, productId: bundleProduct.id, name: bundleProduct.name, unit: bundleProduct.unit, qty: 2, priceMinor: bundleProduct.priceMinor, costMinor: bundleProduct.costMinor, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 1200 });
    await db.createSaleItemBundleComponent({ businessId: "b1", saleItemId: item.id, bundleId: bundle.id, componentProductId: component.id, componentNameSnapshot: component.name, quantityPerBundleSnapshot: 2, costMinorSnapshot: component.costMinor, compositionVersion: bundle.version });
    await new SalesStockService(db).applySale("b1", "u1", "r2", sale.id, [item], null);
    expect((await db.findBalance(component.id, "b1", null))?.qtyOnHand).toBe(1);
    expect(await db.findBalance(bundleProduct.id, "b1", null)).toBeNull();
  });

  it("uses the draft snapshot after a bundle is edited and aggregates shared components", async () => {
    const db = createMemoryDb();
    const componentA = await db.createProduct({ businessId: "b1", categoryId: null, name: "Component A", sku: "A", barcode: null, brand: null, unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    const componentB = await db.createProduct({ businessId: "b1", categoryId: null, name: "Component B", sku: "B", barcode: null, brand: null, unit: "pc", costMinor: 75, priceMinor: 150, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    const bundleProduct = await db.createProduct({ businessId: "b1", categoryId: null, name: "Snapshot kit", sku: "SNAP", barcode: null, brand: null, unit: "kit", costMinor: 125, priceMinor: 300, taxRateBps: null, reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null, productType: "BUNDLE" });
    const bundle = await db.createProductBundle({ businessId: "b1", bundleProductId: bundleProduct.id, version: 1 });
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: componentA.id, quantity: 1, position: 0 });
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: componentB.id, quantity: 1, position: 1 });
    await db.upsertBalance({ businessId: "b1", productId: componentA.id, branchId: null, qtyOnHand: 10 });
    await db.upsertBalance({ businessId: "b1", productId: componentB.id, branchId: null, qtyOnHand: 10 });
    const sale = await db.createSale({ businessId: "b1", receiptNo: "2026-000003", status: "DRAFT", subtotalMinor: 300, discountMinor: 0, taxMinor: 0, totalMinor: 300, paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "r1", idempotencyKey: null, registerId: null, branchId: null, createdAt: new Date() });
    const first = await db.createSaleItem({ businessId: "b1", saleId: sale.id, productId: bundleProduct.id, name: bundleProduct.name, unit: bundleProduct.unit, qty: 1, priceMinor: 300, costMinor: 125, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 300 });
    const second = await db.createSaleItem({ businessId: "b1", saleId: sale.id, productId: bundleProduct.id, name: bundleProduct.name, unit: bundleProduct.unit, qty: 2, priceMinor: 300, costMinor: 125, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 600 });
    for (const item of [first, second]) {
      await db.createSaleItemBundleComponent({ businessId: "b1", saleItemId: item.id, bundleId: bundle.id, componentProductId: componentA.id, componentNameSnapshot: componentA.name, quantityPerBundleSnapshot: 1, costMinorSnapshot: componentA.costMinor, compositionVersion: bundle.version });
      await db.createSaleItemBundleComponent({ businessId: "b1", saleItemId: item.id, bundleId: bundle.id, componentProductId: componentB.id, componentNameSnapshot: componentB.name, quantityPerBundleSnapshot: 1, costMinorSnapshot: componentB.costMinor, compositionVersion: bundle.version });
    }
    await db.deleteBundleComponents(bundle.id, "b1");
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: componentA.id, quantity: 2, position: 0 });
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: componentB.id, quantity: 1, position: 1 });
    await db.updateProductBundle(bundle.id, "b1", { version: 2 });

    await new SalesStockService(db).applySale("b1", "u1", "r2", sale.id, [first, second], null);

    expect((await db.findBalance(componentA.id, "b1", null))?.qtyOnHand).toBe(7);
    expect((await db.findBalance(componentB.id, "b1", null))?.qtyOnHand).toBe(7);
  });

  it("fails safely when a bundle sale item has no historical snapshot", async () => {
    const db = createMemoryDb();
    const bundleProduct = await db.createProduct({ businessId: "b1", categoryId: null, name: "Missing snapshot kit", sku: "MISS", barcode: null, brand: null, unit: "kit", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null, productType: "BUNDLE" });
    const sale = await db.createSale({ businessId: "b1", receiptNo: "2026-000004", status: "DRAFT", subtotalMinor: 200, discountMinor: 0, taxMinor: 0, totalMinor: 200, paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "r1", idempotencyKey: null, registerId: null, branchId: null, createdAt: new Date() });
    const item = await db.createSaleItem({ businessId: "b1", saleId: sale.id, productId: bundleProduct.id, name: bundleProduct.name, unit: bundleProduct.unit, qty: 1, priceMinor: 200, costMinor: 100, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 200 });
    await expect(new SalesStockService(db).applySale("b1", "u1", "r2", sale.id, [item], null)).rejects.toThrow("INVALID_BUNDLE_SNAPSHOT");
  });
});

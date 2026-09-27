import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../common/memory.db";
import { SalesStockService } from "./sale-stock-service";

describe("sales stock locking", () => {
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
});

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase2 catalog port", () => {
  it("round-trips a category scoped to its business", async () => {
    const db = createMemoryDb();
    const cat = await db.createCategory({ businessId: "b1", name: "Drinks", description: null, isActive: true });
    expect((await db.listCategories("b1")).map((c) => c.id)).toContain(cat.id);
    expect(await db.listCategories("b2")).toEqual([]);
    expect(await db.findCategoryById(cat.id, "b2")).toBeNull();
  });
  it("round-trips a product scoped to its business", async () => {
    const db = createMemoryDb();
    const p = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: "COKE-1", barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    expect(await db.findProductById(p.id, "b1")).not.toBeNull();
    expect(await db.findProductById(p.id, "b2")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { CatalogService } from "./catalog.service";

async function setup() {
  const db = createMemoryDb();
  return { db, svc: new CatalogService(db) };
}

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

describe("phase2 catalog service", () => {
  it("does not allow legacy URL edits to silently orphan an active managed photo", async () => {
    const { db, svc } = await setup();
    const product = await svc.createProduct("b1", "u1", "r1", { name: "Milk", priceMinor: 13500 });
    const url = "https://example.supabase.co/storage/v1/object/public/nexpos-product-media/milk.webp";
    await db.replaceProductMediaAtomic("b1", product.id, null, {
      businessId: "b1", productId: product.id, actorId: "u1",
      storagePath: `businesses/b1/products/${product.id}/first.webp`, publicUrl: url,
      contentType: "image/webp", bytes: 256, width: 200, height: 200,
    });
    await expect(svc.updateProduct("b1", "u1", "r2", product.id, {
      imageUrl: "https://other.example/milk.png",
    })).rejects.toThrow("PRODUCT_MEDIA_MANAGED");
    await svc.updateProduct("b1", "u1", "r3", product.id, { name: "Oat Milk", imageUrl: url });
    expect((await db.findProductById(product.id, "b1"))?.imageUrl).toBe(url);
    expect((await db.getActiveProductMedia("b1", product.id))?.state).toBe("ACTIVE");
  });
  it("creates a product and audits product.create", async () => {
    const { db, svc } = await setup();
    const p = await svc.createProduct("b1", "u1", "r1", { name: "Coke", priceMinor: 2500, costMinor: 1000 });
    expect(p.sku).toBeNull();
    expect((await db.listAudit()).some((a) => a.action === "product.create")).toBe(true);
  });
  it("rejects duplicate sku within a business but allows across businesses", async () => {
    const { svc } = await setup();
    await svc.createProduct("b1", "u1", "r1", { name: "A", priceMinor: 100, sku: "x-1" });
    await expect(svc.createProduct("b1", "u1", "r1", { name: "B", priceMinor: 100, sku: "X-1" })).rejects.toThrow("CATALOG_DUPLICATE_SKU");
    await svc.createProduct("b2", "u1", "r1", { name: "C", priceMinor: 100, sku: "X-1" });
  });
  it("rejects a category from another business with VALIDATION", async () => {
    const { svc } = await setup();
    const cat = await svc.createCategory("b1", "u1", "r1", { name: "Drinks" });
    await expect(
      svc.createProduct("b2", "u1", "r1", { name: "Coke", priceMinor: 100, categoryId: cat.id }),
    ).rejects.toThrow("VALIDATION");
  });
  it("imports atomically: one bad row creates nothing", async () => {
    const { db, svc } = await setup();
    await expect(
      svc.importProducts("b1", "u1", "r1", { items: [
        { name: "A", priceMinor: 100, sku: "dup" },
        { name: "B", priceMinor: 100, sku: "DUP" },
      ] }),
    ).rejects.toThrow("CATALOG_DUPLICATE_SKU");
    expect(await db.listProducts("b1")).toEqual([]);
  });
  it("archives and restores with audit entries", async () => {
    const { db, svc } = await setup();
    const p = await svc.createProduct("b1", "u1", "r1", { name: "Coke", priceMinor: 100 });
    await svc.setProductActive("b1", "u1", "r1", p.id, false);
    expect((await db.findProductById(p.id, "b1"))!.isActive).toBe(false);
    const actions = (await db.listAudit()).map((a) => a.action);
    expect(actions).toContain("product.archive");
  });
});

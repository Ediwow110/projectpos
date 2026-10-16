import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";

async function seed(db: Parameters<Parameters<typeof withPg>[0]>[0]) {
  const business = await db.createBusiness({ name: "Media PG QA", currency: "PHP" });
  const product = await db.createProduct({
    businessId: business.id, name: "Oat Milk", categoryId: null, sku: null,
    barcode: null, brand: null, unit: "pc", costMinor: 0, priceMinor: 13500,
    taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  const asset = (number: number) => ({
    businessId: business.id, productId: product.id, actorId: "u1",
    storagePath: `businesses/${business.id}/products/${product.id}/image-${number}.webp`,
    publicUrl: `https://media.example.test/image-${number}.webp`,
    contentType: "image/webp" as const, width: 200, height: 200, bytes: 200,
  });
  return { business, product, asset };
}

describe("product media PostgreSQL parity and rollback", () => {
  it("atomically replaces and detaches media while preserving cleanup candidates", async () => withPg(async (db) => {
    const { business, product, asset } = await seed(db);
    const first = await db.replaceProductMediaAtomic(business.id, product.id, null, asset(1));
    expect(first.product.imageUrl).toBe(asset(1).publicUrl);
    await expect(db.replaceProductMediaAtomic(business.id, product.id, null, asset(2))).rejects.toThrow("PRODUCT_MEDIA_CONFLICT");
    const second = await db.replaceProductMediaAtomic(business.id, product.id, first.asset.id, asset(2));
    expect(second.oldAsset?.id).toBe(first.asset.id);
    expect((await db.getActiveProductMedia(business.id, product.id))?.id).toBe(second.asset.id);
    const detached = await db.detachProductMediaAtomic(business.id, product.id, second.asset.id);
    expect(detached.product.imageUrl).toBeNull();
    expect((await db.listProductMediaCleanupCandidates(10)).map((r) => r.id))
      .toEqual(expect.arrayContaining([first.asset.id, second.asset.id]));
    await db.markProductMediaCleanupResult(business.id, first.asset.id, true);
    await db.markProductMediaCleanupResult(business.id, second.asset.id, true);
    expect(await db.listProductMediaCleanupCandidates(10)).toEqual([]);
  }));

  it("rolls back a failed insert without losing the previous working image", async () => withPg(async (db) => {
    const { business, product, asset } = await seed(db);
    const first = await db.replaceProductMediaAtomic(business.id, product.id, null, asset(1));
    await expect(db.replaceProductMediaAtomic(business.id, product.id, first.asset.id, {
      ...asset(2), storagePath: asset(1).storagePath,
    })).rejects.toThrow();
    expect((await db.getActiveProductMedia(business.id, product.id))?.id).toBe(first.asset.id);
    expect((await db.findProductById(product.id, business.id))?.imageUrl).toBe(asset(1).publicUrl);
    expect(await db.listProductMediaCleanupCandidates(10)).toEqual([]);
  }));

  it("returns NOT_FOUND on a cross-business product write", async () => withPg(async (db) => {
    const { business, product, asset } = await seed(db);
    const other = await db.createBusiness({ name: "Other Tenant", currency: "PHP" });
    await expect(db.replaceProductMediaAtomic(other.id, product.id, null, {
      ...asset(1), businessId: other.id,
      storagePath: `businesses/${other.id}/products/${product.id}/test.webp`,
    })).rejects.toThrow("NOT_FOUND");
    expect(await db.getActiveProductMedia(business.id, product.id)).toBeNull();
  }));
});

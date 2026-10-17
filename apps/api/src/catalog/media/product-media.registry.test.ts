import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { CatalogService } from "../nest/catalog.service";

async function setup() {
  const db = createMemoryDb();
  const product = await new CatalogService(db).createProduct("b1", "u1", "r1", {
    name: "Oat Milk", priceMinor: 13500,
  });
  const create = (n: number) => ({
    businessId: "b1", productId: product.id, actorId: "u1",
    storagePath: `businesses/b1/products/${product.id}/photo-${n}.webp`,
    publicUrl: `https://images.test/photo-${n}.webp`,
    contentType: "image/webp" as const,
    bytes: 150, width: 200, height: 200,
  });
  return { db, product, create };
}

describe("tenant-scoped managed product media registry", () => {
  it("atomically tracks the active media and displayed image URL", async () => {
    const { db, product, create } = await setup();
    expect(await db.getActiveProductMedia("b1", product.id)).toBeNull();
    const result = await db.replaceProductMediaAtomic("b1", product.id, null, create(1));
    expect(result.asset.state).toBe("ACTIVE");
    expect(result.oldAsset).toBeNull();
    expect(result.product.imageUrl).toBe(create(1).publicUrl);
    expect((await db.getActiveProductMedia("b1", product.id))?.id).toBe(result.asset.id);
  });

  it("serializes replacement and rejects stale active asset versions", async () => {
    const { db, product, create } = await setup();
    const first = await db.replaceProductMediaAtomic("b1", product.id, null, create(1));
    await expect(db.replaceProductMediaAtomic("b1", product.id, null, create(2)))
      .rejects.toThrow("PRODUCT_MEDIA_CONFLICT");
    const second = await db.replaceProductMediaAtomic("b1", product.id, first.asset.id, create(2));
    expect(second.oldAsset?.id).toBe(first.asset.id);
    expect(second.product.imageUrl).toBe(create(2).publicUrl);
    const pending = await db.listProductMediaCleanupCandidates(5);
    expect(pending.some((row) => row.id === first.asset.id)).toBe(true);
    expect((await db.getActiveProductMedia("b1", product.id))?.id).toBe(second.asset.id);
  });

  it("does not expose another business product or allow forged asset ownership", async () => {
    const { db, product, create } = await setup();
    expect(await db.getActiveProductMedia("b2", product.id)).toBeNull();
    await expect(db.replaceProductMediaAtomic("b2", product.id, null, { ...create(1), businessId: "b2" }))
      .rejects.toThrow("NOT_FOUND");
    await expect(db.replaceProductMediaAtomic("b1", product.id, null, { ...create(1), businessId: "b2" }))
      .rejects.toThrow("PRODUCT_MEDIA_INVALID");
    expect((await db.findProductById(product.id, "b1"))?.imageUrl).toBeNull();
  });

  it("detaches a managed image but preserves its record for retriable cleanup", async () => {
    const { db, product, create } = await setup();
    const first = await db.replaceProductMediaAtomic("b1", product.id, null, create(1));
    const detached = await db.detachProductMediaAtomic("b1", product.id, first.asset.id);
    expect(detached.product.imageUrl).toBeNull();
    expect(detached.oldAsset?.id).toBe(first.asset.id);
    expect(await db.getActiveProductMedia("b1", product.id)).toBeNull();
    const candidates = await db.listProductMediaCleanupCandidates(5);
    expect(candidates.map((row) => row.id)).toContain(first.asset.id);
    await db.markProductMediaCleanupResult("b1", first.asset.id, true);
    await db.markProductMediaCleanupResult("b1", first.asset.id, true);
    expect(await db.listProductMediaCleanupCandidates(5)).toEqual([]);
  });

  it("rejects upload beyond the per-business active image quota", async () => {
    const { db, product, create } = await setup();
    const { id: _id, ...template } = product;
    for (let i = 0; i < 200; i += 1) {
      const p = await db.createProduct({ ...template, name: `Quota item ${i}` });
      await db.replaceProductMediaAtomic("b1", p.id, null, {
        ...create(i + 1), productId: p.id,
        storagePath: `businesses/b1/products/${p.id}/quota-${i}.webp`, bytes: 1024 * 1024,
      });
    }
    await expect(db.replaceProductMediaAtomic("b1", product.id, null, create(300)))
      .rejects.toThrow("PRODUCT_MEDIA_QUOTA");
  });

  it("rejects invalid media object metadata and paths in the database port", async () => {
    const { db, product, create } = await setup();
    await expect(db.replaceProductMediaAtomic("b1", product.id, null, {
      ...create(1), bytes: 1024 * 1024 + 1,
    })).rejects.toThrow("PRODUCT_MEDIA_INVALID");
    await expect(db.replaceProductMediaAtomic("b1", product.id, null, {
      ...create(1), storagePath: "businesses/b2/products/other/photo.webp",
    })).rejects.toThrow("PRODUCT_MEDIA_INVALID");
  });
});

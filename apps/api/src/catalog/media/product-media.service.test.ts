import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createMemoryDb } from "../../common/memory.db";
import { CatalogService } from "../nest/catalog.service";
import { FakeProductMediaStorage } from "../../../test/support/fake-product-media.storage";
import { ProductMediaService } from "./product-media.service";
import { ProductMediaCleanup } from "./product-media-cleanup";

async function setup() {
  const db = createMemoryDb();
  const product = await new CatalogService(db).createProduct("b1", "owner", "r1", { name: "Oat Milk", priceMinor: 13500 });
  const storage = new FakeProductMediaStorage();
  const service = new ProductMediaService(db, storage);
  const auth = {
    userId: "owner", businessId: "b1", sessionId: "session1", role: "owner",
    activeBranchId: null, authenticatedAt: new Date(),
  };
  const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
  const file = { buffer, mimetype: "image/png", size: buffer.length };
  return { db, product, storage, service, auth, file };
}

describe("managed owner product media orchestration", () => {
  it("uploads a validated owner image with business audit and unchanged product details", async () => {
    const { db, product, storage, service, auth, file } = await setup();
    const result = await service.upload(auth, "r1", product.id, file, null);
    expect(result.asset.state).toBe("ACTIVE");
    expect(result.asset.contentType).toBe("image/webp");
    expect((await db.findProductById(product.id, "b1"))?.imageUrl).toBe(result.asset.publicUrl);
    expect((await storage.get(result.asset.storagePath))?.subarray(0, 4).toString()).toBe("RIFF");
    expect((await db.listAudit("b1")).map((r) => r.action)).toContain("product.media.upload");
  });

  it("denies nonowners and cross-tenant product IDs before writing storage", async () => {
    const { service, storage, auth, product, file } = await setup();
    await expect(service.upload({ ...auth, role: "cashier" }, "r1", product.id, file, null)).rejects.toThrow("FORBIDDEN");
    await expect(service.upload({ ...auth, businessId: "b2" }, "r1", product.id, file, null)).rejects.toThrow("NOT_FOUND");
    expect(storage.paths()).toEqual([]);
  });

  it("preserves the old image on provider failures or stale version conflicts and deletes new orphans", async () => {
    const { db, service, storage, auth, product, file } = await setup();
    const first = await service.upload(auth, "r1", product.id, file, null);
    storage.failNextPut = true;
    await expect(service.upload(auth, "r2", product.id, file, first.asset.id)).rejects.toThrow("PRODUCT_MEDIA_STORAGE");
    await expect(service.upload(auth, "r3", product.id, file, null)).rejects.toThrow("PRODUCT_MEDIA_CONFLICT");
    expect(storage.paths()).toEqual([first.asset.storagePath]);
    expect((await db.getActiveProductMedia("b1", product.id))?.id).toBe(first.asset.id);
    expect((await db.findProductById(product.id, "b1"))?.imageUrl).toBe(first.asset.publicUrl);
  });

  it("marks retired photos for cleanup and retries a transient delete error", async () => {
    const { db, service, storage, auth, product, file } = await setup();
    const first = await service.upload(auth, "r1", product.id, file, null);
    const second = await service.upload(auth, "r2", product.id, file, first.asset.id);
    const deleted = await service.remove(auth, "r3", product.id, second.asset.id);
    expect(deleted.product.imageUrl).toBeNull();
    expect((await db.listProductMediaCleanupCandidates(10)).length).toBe(2);
    const cleanup = new ProductMediaCleanup(db, storage);
    storage.failNextRemove = true;
    const initial = await cleanup.sweep(10);
    expect(initial.failed).toBe(1);
    expect(initial.deleted).toBe(1);
    const final = await cleanup.sweep(10);
    expect(final.failed).toBe(0);
    expect(final.deleted).toBe(1);
    expect(storage.paths()).toEqual([]);
    expect(await db.listProductMediaCleanupCandidates(10)).toEqual([]);
  });
});

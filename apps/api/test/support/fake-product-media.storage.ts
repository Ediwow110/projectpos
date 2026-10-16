import type { ProductMediaStorage } from "../../src/catalog/media/product-media.storage";

/** Test-only storage double: no network, provider keys, or production import paths. */
export class FakeProductMediaStorage implements ProductMediaStorage {
  private readonly blobs = new Map<string, Buffer>();
  failNextPut = false;
  failNextRemove = false;

  async put(path: string, content: Buffer): Promise<{ url: string }> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("PRODUCT_MEDIA_STORAGE");
    }
    if (this.blobs.has(path)) throw new Error("PRODUCT_MEDIA_ALREADY_EXISTS");
    this.blobs.set(path, Buffer.from(content));
    return { url: `https://images.test/storage/v1/object/public/nexpos-product-media/${path}` };
  }

  async remove(path: string): Promise<void> {
    if (this.failNextRemove) {
      this.failNextRemove = false;
      throw new Error("PRODUCT_MEDIA_STORAGE");
    }
    this.blobs.delete(path);
  }

  async get(path: string): Promise<Buffer | null> {
    const stored = this.blobs.get(path);
    return stored ? Buffer.from(stored) : null;
  }
}

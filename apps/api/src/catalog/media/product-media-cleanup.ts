import type { DbPort } from "../../common/db.port";
import type { ProductMediaStorage } from "./product-media.storage";

/** Retries deletion of old image bytes without ever removing the active product image. */
export class ProductMediaCleanup {
  constructor(
    private readonly db: DbPort,
    private readonly storage: ProductMediaStorage | null,
  ) {}

  async sweep(limit = 25): Promise<{ deleted: number; failed: number }> {
    if (!this.storage) return { deleted: 0, failed: 0 };
    const candidates = await this.db.listProductMediaCleanupCandidates(limit);
    let deleted = 0;
    let failed = 0;
    for (const asset of candidates) {
      try {
        await this.storage.remove(asset.storagePath);
        await this.db.markProductMediaCleanupResult(asset.businessId, asset.id, true);
        deleted += 1;
      } catch {
        failed += 1;
        await this.db.markProductMediaCleanupResult(asset.businessId, asset.id, false);
      }
    }
    return { deleted, failed };
  }
}

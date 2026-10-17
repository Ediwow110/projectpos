import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { DbPort } from "../../common/db.port";
import type { ProductMediaStorage } from "./product-media.storage";

/** Retries deletion of old image bytes without ever removing the active product image. */
export class ProductMediaCleanup implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private readonly db: DbPort,
    private readonly storage: ProductMediaStorage | null,
  ) {}

  onModuleInit(): void {
    if (!this.storage) return;
    this.timer = setInterval(() => { void this.sweep().catch(() => undefined); }, 5 * 60_000);
    this.timer.unref();
    void this.sweep().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

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

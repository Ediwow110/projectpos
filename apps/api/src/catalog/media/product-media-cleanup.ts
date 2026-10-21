import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { DbPort } from "../../common/db.port";
import { incrementMetric, setMetric } from "../../common/metrics";
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
    // The sweep's outcome is an operational signal. Discarding it - or swallowing
    // its rejection - leaves an unbounded backlog of retired image bytes with no
    // trace anywhere, exactly the failure a worker is here to surface.
    const run = (): void => {
      void this.sweep().then(
        (outcome) => {
          setMetric("pos_product_media_cleanup_deleted", outcome.deleted);
          setMetric("pos_product_media_cleanup_failed", outcome.failed);
          if (outcome.failed > 0) {
            // Counts only: no storage paths, asset ids, or business ids in the line.
            console.warn(`product-media cleanup: ${outcome.failed} retired image deletion(s) failed`);
          }
        },
        () => {
          incrementMetric("pos_product_media_cleanup_worker_failures_total");
        },
      );
    };
    run();
    this.timer = setInterval(run, 5 * 60_000);
    this.timer.unref();
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

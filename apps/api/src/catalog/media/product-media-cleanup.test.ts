import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMetrics, resetMetricsForTests } from "../../common/metrics";
import { ProductMediaCleanup } from "./product-media-cleanup";

const candidate = { businessId: "business-1", id: "asset-1", storagePath: "images/private-path-1.png" };

function dbStub(behavior: "rejects" | "mixed") {
  const marked: boolean[] = [];
  const db = {
    listProductMediaCleanupCandidates: vi.fn(async () => {
      if (behavior === "rejects") throw new Error("db unavailable");
      return [candidate, { ...candidate, id: "asset-2", storagePath: "images/private-path-2.png" }];
    }),
    markProductMediaCleanupResult: vi.fn(async (_businessId: string, _id: string, ok: boolean) => {
      marked.push(ok);
    }),
  };
  const storage = {
    remove: vi.fn(async (path: string) => {
      if (path.endsWith("private-path-2.png")) throw new Error("storage unavailable");
    }),
  };
  return { db, storage, marked };
}

describe("product-media cleanup worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts a rejected sweep instead of discarding the rejection", async () => {
    resetMetricsForTests();
    const { db, storage } = dbStub("rejects");
    const worker = new ProductMediaCleanup(db as never, storage as never);
    try {
      worker.onModuleInit();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(renderMetrics()).toContain("pos_product_media_cleanup_worker_failures_total 1");
    } finally {
      worker.onModuleDestroy();
    }
  });

  it("reports the failed-delete count of a completed sweep without leaking asset data", async () => {
    resetMetricsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db, storage, marked } = dbStub("mixed");
    const worker = new ProductMediaCleanup(db as never, storage as never);
    try {
      worker.onModuleInit();
      expect(await worker.sweep()).toEqual({ deleted: 1, failed: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(marked.filter((ok) => ok)).toHaveLength(2);
      expect(marked.filter((ok) => !ok)).toHaveLength(2);
      const metrics = renderMetrics();
      expect(metrics).toContain("pos_product_media_cleanup_deleted 1");
      expect(metrics).toContain("pos_product_media_cleanup_failed 1");
      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0]!.join(" ");
      expect(line).toContain("1");
      expect(line).not.toContain("private-path");
      expect(line).not.toContain("asset-");
      expect(line).not.toContain("business-1");
    } finally {
      worker.onModuleDestroy();
    }
  });
});

import { describe, expect, it } from "vitest";

import type { PosProduct } from "./pos-sale-model";
import { MemorySyncStore, type SyncStore } from "./sync-store";
import { readCatalogSnapshot, writeCatalogSnapshot } from "./use-pos-offline";

const product = (id: string): PosProduct => ({
  id,
  name: id,
  sku: null,
  categoryId: null,
  priceMinor: 100,
  isActive: true,
});

/** A store whose IndexedDB backend throws, as it does on a till whose offline
 *  database is corrupted, blocked, or out of quota. */
function faultedStore(): SyncStore {
  const store = new MemorySyncStore();
  store.cacheList = async <T,>() => {
    throw new Error("INDEXEDDB_UNAVAILABLE");
  };
  return store;
}

describe("writeCatalogSnapshot", () => {
  it("stamps the last-sync time when every product was cached", async () => {
    const store = new MemorySyncStore();

    const result = await writeCatalogSnapshot(store, [product("a"), product("b")]);

    expect(result).toMatchObject({ ok: true });
    expect(await store.metaGet("lastSyncAt")).not.toBeNull();
  });

  it("reports the fault and stamps no success when the cache write fails", async () => {
    const store = new MemorySyncStore();
    let writes = 0;
    store.cachePut = async () => {
      writes += 1;
      if (writes > 1) throw new Error("QUOTA_EXCEEDED");
    };

    const result = await writeCatalogSnapshot(store, [product("a"), product("b")]);

    expect(result).toMatchObject({ ok: false });
    expect(await store.metaGet("lastSyncAt")).toBeNull();
  });
});

describe("readCatalogSnapshot", () => {
  it("reads back the cached catalog on a healthy store", async () => {
    const store = new MemorySyncStore();
    await store.cachePut("catalog", "a", product("a"), "2026-10-21T00:00:00.000Z");

    const snapshot = await readCatalogSnapshot(store);

    expect(snapshot).toMatchObject({ ok: true, cachedItems: [product("a")], catalogAt: null });
  });

  it("distinguishes an unreadable cache from a genuinely empty one", async () => {
    const snapshot = await readCatalogSnapshot(faultedStore());

    // An IndexedDB fault must never resolve as "no products, never synced".
    expect(snapshot).toMatchObject({ ok: false });
    expect(snapshot.cachedItems).toEqual([]);
  });
});

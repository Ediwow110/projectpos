import { describe, expect, it } from "vitest";
import {
  activeSyncScope,
  clearActiveSyncScope,
  persistActiveSyncScope,
  syncDatabaseName,
  type OutboxCommand,
  type SyncStore,
} from "../src/lib/sync-store";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

async function conformance(makeStore: () => SyncStore): Promise<void> {
  const store = makeStore();
  const a = await store.enqueue({
    localId: "a", commandType: "sale.complete", key: "k1", fingerprint: "fp1",
    payload: { saleId: "s1" }, queuedAt: "2026-09-24T00:00:02.000Z",
    lastAttemptAt: null, provisionalReceipt: "OFFLINE-00000001",
  });
  expect(a.status).toBe("QUEUED");
  expect(a.attempts).toBe(0);
  await store.enqueue({
    localId: "b", commandType: "sale.complete", key: "k2", fingerprint: "fp2",
    payload: { saleId: "s2" }, queuedAt: "2026-09-24T00:00:01.000Z",
    lastAttemptAt: null, provisionalReceipt: "OFFLINE-00000002",
  });
  const pending = await store.listPending();
  expect(pending.map((c: OutboxCommand) => c.localId)).toEqual(["b", "a"]);
  const marked = await store.mark({ localId: "b", status: "SYNCED", serverResultId: "sale9" });
  expect(marked.status).toBe("SYNCED");
  expect(marked.serverResultId).toBe("sale9");
  expect((await store.listPending()).map((c: OutboxCommand) => c.localId)).toEqual(["a"]);
  await store.cachePut("catalog", "p1", { name: "Coke" }, "2026-09-24T00:00:00.000Z");
  expect(await store.cacheGet<{ name: string }>("catalog", "p1")).toEqual({
    value: { name: "Coke" },
    cachedAt: "2026-09-24T00:00:00.000Z",
  });
  expect((await store.cacheList("catalog")).length).toBe(1);
  await store.metaSet("lastSyncAt", "2026-09-24T00:00:00.000Z");
  expect(await store.metaGet("lastSyncAt")).toBe("2026-09-24T00:00:00.000Z");
  expect(await store.metaGet("missing")).toBeNull();
}

describe("phase9b sync store", () => {
  it("memory store passes the conformance suite", async () => {
    const { MemorySyncStore } = await import("../src/lib/sync-store");
    await conformance(() => new MemorySyncStore());
  });

  it("keeps offline databases distinct for different authenticated tenants", () => {
    expect(syncDatabaseName({ userId: "user-a", businessId: "biz-1" }))
      .not.toBe(syncDatabaseName({ userId: "user-b", businessId: "biz-1" }));
    expect(syncDatabaseName({ userId: "user-a", businessId: "biz-1" }))
      .not.toBe(syncDatabaseName({ userId: "user-a", businessId: "biz-2" }));
  });

  it("persists only the active offline tenant and detaches it on logout", () => {
    const storage = memoryStorage();
    persistActiveSyncScope({ userId: "user-a", businessId: "biz-a" }, storage);
    expect(activeSyncScope(storage)).toEqual({ userId: "user-a", businessId: "biz-a" });

    persistActiveSyncScope({ userId: "user-b", businessId: "biz-b" }, storage);
    expect(activeSyncScope(storage)).toEqual({ userId: "user-b", businessId: "biz-b" });

    clearActiveSyncScope(storage);
    expect(activeSyncScope(storage)).toBeNull();
  });
});

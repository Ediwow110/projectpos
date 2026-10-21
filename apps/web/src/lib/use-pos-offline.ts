"use client";

import { useEffect, useState } from "react";

import { ApiError, apiFetch } from "./api";
import { watchConnectivity } from "./connectivity";
import {
  IndexedDbSyncStore,
  clearActiveSyncScope,
  createActiveSyncStore,
  persistActiveSyncScope,
  type SyncStore,
} from "./sync-store";
import type { PosProduct } from "./pos-sale-model";

interface PosIdentity {
  userId: string;
  businessId: string;
}

export interface CatalogWriteResult {
  ok: boolean;
  error: string | null;
  cached: number;
}

export interface CatalogSnapshot {
  ok: boolean;
  error: string | null;
  cachedItems: PosProduct[];
  catalogAt: string | null;
}

function describeFault(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Offline catalog unavailable.";
}

/** Copies the online catalog into the offline cache. A fault is returned, never thrown,
 * so the caller cannot mistake a failed write for a completed sync. */
export async function writeCatalogSnapshot(
  store: SyncStore,
  items: PosProduct[],
): Promise<CatalogWriteResult> {
  const stamp = new Date().toISOString();
  try {
    for (const product of items) await store.cachePut("catalog", product.id, product, stamp);
    await store.metaSet("lastSyncAt", stamp);
    return { ok: true, error: null, cached: items.length };
  } catch (error) {
    return { ok: false, error: describeFault(error), cached: 0 };
  }
}

/** Reads back the offline catalog cache. A fault stays distinguishable from a cache that
 * is genuinely empty, which is what the till displays as "No products found". */
export async function readCatalogSnapshot(
  store: SyncStore,
): Promise<CatalogSnapshot> {
  try {
    const cached = await store.cacheList<PosProduct>("catalog");
    return {
      ok: true,
      error: null,
      cachedItems: cached.map((entry) => entry.value),
      catalogAt: await store.metaGet("lastSyncAt"),
    };
  } catch (error) {
    return { ok: false, error: describeFault(error), cachedItems: [], catalogAt: null };
  }
}

export function usePosOffline(
  identity: PosIdentity | undefined,
  identityError: unknown,
  identityLoading: boolean,
  onlineProducts: PosProduct[] | undefined,
): {
  store: IndexedDbSyncStore | null;
  offline: boolean;
  catalogAt: string | null;
  cachedItems: PosProduct[];
  catalogError: string | null;
  now: string;
} {
  const [store, setStore] = useState<IndexedDbSyncStore | null>(() => createActiveSyncStore());
  const [offline, setOffline] = useState(false);
  const [catalogAt, setCatalogAt] = useState<string | null>(null);
  const [cachedItems, setCachedItems] = useState<PosProduct[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [now, setNow] = useState("");

  useEffect(() => {
    if (identity) {
      persistActiveSyncScope(identity);
      setStore((current) => current?.scope.userId === identity.userId && current.scope.businessId === identity.businessId
        ? current
        : new IndexedDbSyncStore(identity));
      return;
    }
    if (identityError instanceof ApiError && (identityError.status === 401 || identityError.status === 403)) {
      clearActiveSyncScope();
      setStore(null);
      setCachedItems([]);
      setCatalogAt(null);
      setCatalogError(null);
    }
  }, [identity, identityError]);

  useEffect(() => {
    setNow(new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }));
    return watchConnectivity({
      isOnline: () => navigator.onLine,
      ping: () => apiFetch<{ ok: boolean }>("/api/v1/health").then(() => true).catch(() => false),
      intervalMs: 15000,
      onChange: (state) => setOffline(state === "offline"),
    });
  }, []);

  useEffect(() => {
    if (!onlineProducts || !store) return;
    void writeCatalogSnapshot(store, onlineProducts)
      .then((result) => setCatalogError(result.error))
      .catch((error: unknown) => setCatalogError(describeFault(error)));
  }, [onlineProducts, store]);

  useEffect(() => {
    if (!offline || !store || identityLoading) return;
    void readCatalogSnapshot(store)
      .then((snapshot) => {
        setCatalogError(snapshot.error);
        // A fault is not an empty cache: keep the last known items rather than
        // presenting "No products found" / "(never synced)".
        if (!snapshot.ok) return;
        setCachedItems(snapshot.cachedItems);
        setCatalogAt(snapshot.catalogAt);
      })
      .catch((error: unknown) => setCatalogError(describeFault(error)));
  }, [offline, store, identityLoading]);

  return { store, offline, catalogAt, cachedItems, catalogError, now };
}

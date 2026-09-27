"use client";

import { useEffect, useState } from "react";

import { ApiError, apiFetch } from "./api";
import { watchConnectivity } from "./connectivity";
import {
  IndexedDbSyncStore,
  clearActiveSyncScope,
  createActiveSyncStore,
  persistActiveSyncScope,
} from "./sync-store";
import type { PosProduct } from "./pos-sale-model";

interface PosIdentity {
  userId: string;
  businessId: string;
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
  now: string;
} {
  const [store, setStore] = useState<IndexedDbSyncStore | null>(() => createActiveSyncStore());
  const [offline, setOffline] = useState(false);
  const [catalogAt, setCatalogAt] = useState<string | null>(null);
  const [cachedItems, setCachedItems] = useState<PosProduct[]>([]);
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
    const stamp = new Date().toISOString();
    void (async () => {
      for (const product of onlineProducts) await store.cachePut("catalog", product.id, product, stamp);
      await store.metaSet("lastSyncAt", stamp);
    })();
  }, [onlineProducts, store]);

  useEffect(() => {
    if (!offline || !store || identityLoading) return;
    void (async () => {
      const cached = await store.cacheList<PosProduct>("catalog");
      setCachedItems(cached.map((entry) => entry.value));
      setCatalogAt(await store.metaGet("lastSyncAt"));
    })();
  }, [offline, store, identityLoading]);

  return { store, offline, catalogAt, cachedItems, now };
}

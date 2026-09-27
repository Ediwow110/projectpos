import type { SyncStatus } from "./sync-state";

export interface OutboxCommand {
  localId: string;
  commandType: string;
  key: string;
  fingerprint: string;
  payload: unknown;
  queuedAt: string;
  status: SyncStatus;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  serverResultId: string | null;
  provisionalReceipt: string | null;
}

export type NewOutboxCommand = Omit<
  OutboxCommand,
  "status" | "attempts" | "lastError" | "serverResultId"
>;

export interface SyncStore {
  enqueue(cmd: NewOutboxCommand): Promise<OutboxCommand>;
  listPending(): Promise<OutboxCommand[]>;
  listAll(): Promise<OutboxCommand[]>;
  mark(cmd: Partial<OutboxCommand> & { localId: string }): Promise<OutboxCommand>;
  cachePut(kind: string, key: string, value: unknown, cachedAt: string): Promise<void>;
  cacheGet<T>(kind: string, key: string): Promise<{ value: T; cachedAt: string } | null>;
  cacheList<T>(kind: string): Promise<Array<{ key: string; value: T; cachedAt: string }>>;
  metaGet(key: string): Promise<string | null>;
  metaSet(key: string, value: string): Promise<void>;
}

export interface SyncScope {
  userId: string;
  businessId: string;
}

const ACTIVE_SYNC_SCOPE_KEY = "nexpos-active-sync-scope-v1";

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function validScope(value: unknown): value is SyncScope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SyncScope>;
  return typeof candidate.userId === "string" && candidate.userId.length > 0 &&
    typeof candidate.businessId === "string" && candidate.businessId.length > 0;
}

export function persistActiveSyncScope(
  scope: SyncScope,
  storage: Storage | null = browserStorage(),
): void {
  if (!storage) return;
  storage.setItem(ACTIVE_SYNC_SCOPE_KEY, JSON.stringify(scope));
}

export function activeSyncScope(storage: Storage | null = browserStorage()): SyncScope | null {
  if (!storage) return null;
  const raw = storage.getItem(ACTIVE_SYNC_SCOPE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validScope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearActiveSyncScope(storage: Storage | null = browserStorage()): void {
  storage?.removeItem(ACTIVE_SYNC_SCOPE_KEY);
}

export function syncDatabaseName(scope: SyncScope): string {
  return `pos-sync-v2:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.businessId)}`;
}

function pendingFirst(a: OutboxCommand, b: OutboxCommand): number {
  return a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0;
}

export class MemorySyncStore implements SyncStore {
  private readonly outbox = new Map<string, OutboxCommand>();
  private readonly cache = new Map<string, { value: unknown; cachedAt: string }>();
  private readonly meta = new Map<string, string>();

  async enqueue(cmd: NewOutboxCommand): Promise<OutboxCommand> {
    const row: OutboxCommand = {
      ...cmd,
      status: "QUEUED",
      attempts: 0,
      lastError: null,
      serverResultId: null,
    };
    this.outbox.set(row.localId, row);
    return row;
  }

  async listPending(): Promise<OutboxCommand[]> {
    return [...this.outbox.values()]
      .filter((c) => c.status === "QUEUED" || c.status === "FAILED")
      .sort(pendingFirst);
  }

  async listAll(): Promise<OutboxCommand[]> {
    return [...this.outbox.values()].sort(pendingFirst);
  }

  async mark(cmd: Partial<OutboxCommand> & { localId: string }): Promise<OutboxCommand> {
    const current = this.outbox.get(cmd.localId);
    if (!current) throw new Error("NOT_FOUND");
    const next = { ...current, ...cmd, localId: current.localId };
    this.outbox.set(cmd.localId, next);
    return next;
  }

  async cachePut(kind: string, key: string, value: unknown, cachedAt: string): Promise<void> {
    this.cache.set(`${kind}:${key}`, { value, cachedAt });
  }

  async cacheGet<T>(kind: string, key: string): Promise<{ value: T; cachedAt: string } | null> {
    const hit = this.cache.get(`${kind}:${key}`);
    return (hit ?? null) as { value: T; cachedAt: string } | null;
  }

  async cacheList<T>(kind: string): Promise<Array<{ key: string; value: T; cachedAt: string }>> {
    const prefix = `${kind}:`;
    const out: Array<{ key: string; value: T; cachedAt: string }> = [];
    for (const [k, v] of this.cache) {
      if (k.startsWith(prefix)) out.push({ key: k.slice(prefix.length), value: v.value as T, cachedAt: v.cachedAt });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  async metaGet(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async metaSet(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }
}

const DB_VERSION = 1;

function idb(): IDBFactory {
  const factory = globalThis.indexedDB;
  if (!factory) throw new Error("INDEXEDDB_UNAVAILABLE");
  return factory;
}

function openDb(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb().open(databaseName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "localId" });
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("INDEXEDDB_UNAVAILABLE"));
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("INDEXEDDB_UNAVAILABLE"));
  });
}

async function tx<T>(databaseName: string, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb(databaseName);
  try {
    return await fn(db.transaction(store, mode).objectStore(store));
  } finally {
    db.close();
  }
}

export class IndexedDbSyncStore implements SyncStore {
  readonly scope: SyncScope;
  readonly databaseName: string;

  constructor(scope: SyncScope) {
    this.scope = scope;
    this.databaseName = syncDatabaseName(scope);
  }

  async enqueue(cmd: NewOutboxCommand): Promise<OutboxCommand> {
    const row: OutboxCommand = {
      ...cmd,
      status: "QUEUED",
      attempts: 0,
      lastError: null,
      serverResultId: null,
    };
    await tx(this.databaseName, "outbox", "readwrite", (s) => req(s.put(row)));
    return row;
  }

  async listPending(): Promise<OutboxCommand[]> {
    const all = await this.listAll();
    return all.filter((c) => c.status === "QUEUED" || c.status === "FAILED");
  }

  async listAll(): Promise<OutboxCommand[]> {
    const rows = await tx(this.databaseName, "outbox", "readonly", (s) => req(s.getAll() as IDBRequest<OutboxCommand[]>));
    return [...rows].sort(pendingFirst);
  }

  async mark(cmd: Partial<OutboxCommand> & { localId: string }): Promise<OutboxCommand> {
    const current = await tx(this.databaseName, "outbox", "readonly", (s) => req(s.get(cmd.localId) as IDBRequest<OutboxCommand | undefined>));
    if (!current) throw new Error("NOT_FOUND");
    const next = { ...current, ...cmd, localId: current.localId };
    await tx(this.databaseName, "outbox", "readwrite", (s) => req(s.put(next)));
    return next;
  }

  async cachePut(kind: string, key: string, value: unknown, cachedAt: string): Promise<void> {
    await tx(this.databaseName, "cache", "readwrite", (s) => req(s.put({ key: `${kind}:${key}`, value, cachedAt })));
  }

  async cacheGet<T>(kind: string, key: string): Promise<{ value: T; cachedAt: string } | null> {
    const hit = await tx(this.databaseName, "cache", "readonly", (s) =>
      req(s.get(`${kind}:${key}`) as IDBRequest<{ value: T; cachedAt: string } | undefined>),
    );
    return hit ?? null;
  }

  async cacheList<T>(kind: string): Promise<Array<{ key: string; value: T; cachedAt: string }>> {
    const prefix = `${kind}:`;
    const rows = await tx(this.databaseName, "cache", "readonly", (s) =>
      req(s.getAll() as IDBRequest<Array<{ key: string; value: T; cachedAt: string }>>),
    );
    return rows
      .filter((r) => r.key.startsWith(prefix))
      .map((r) => ({ key: r.key.slice(prefix.length), value: r.value, cachedAt: r.cachedAt }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  async metaGet(key: string): Promise<string | null> {
    const hit = await tx(this.databaseName, "meta", "readonly", (s) =>
      req(s.get(key) as IDBRequest<{ key: string; value: string } | undefined>),
    );
    return hit?.value ?? null;
  }

  async metaSet(key: string, value: string): Promise<void> {
    await tx(this.databaseName, "meta", "readwrite", (s) => req(s.put({ key, value })));
  }
}

export function createActiveSyncStore(
  storage: Storage | null = browserStorage(),
): IndexedDbSyncStore | null {
  const scope = activeSyncScope(storage);
  return scope ? new IndexedDbSyncStore(scope) : null;
}

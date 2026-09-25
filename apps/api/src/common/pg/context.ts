import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";

// Phase 12: client-side id generation, identical to the memory store, so no
// code anywhere depends on a database-side id shape.
let n = 0;
export function nid(prefix: string): string {
  void randomBytes;
  return `${prefix}_${Date.now().toString(36)}_${(n += 1)}`;
}

// The transaction context: inside withLock/withTransaction every port call
// joins the same client (and therefore the same transaction); outside, each
// call uses the pool in autocommit. This is what makes existing service
// critical sections atomic and cross-process safe without service edits.
export class PgContext {
  private pool: Pool;
  private als = new AsyncLocalStorage<PoolClient>();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async client(): Promise<PoolClient> {
    const tx = this.als.getStore();
    if (tx) return tx;
    return this.pool.connect();
  }

  // Whether the current call owns its client (must release it) or borrowed an
  // outer transaction's (must not).
  owns(): boolean {
    return this.als.getStore() === undefined;
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const held = this.als.getStore();
    if (held) return fn();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Transaction-scoped advisory lock: cross-process mutual exclusion that
      // releases with COMMIT/ROLLBACK, so the locked body is one atomic unit.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      const out = await this.als.run(client, () => fn());
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // A dead connection cannot roll back; the release below still runs.
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async withTransaction<T>(fn: (ctx: PgContext) => Promise<T>): Promise<T> {
    const held = this.als.getStore();
    if (held) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await this.als.run(client, () => fn(this));
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // See withLock.
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

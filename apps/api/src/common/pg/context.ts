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

// Pool sizing was measured, not guessed: at the growth cohort's 50
// concurrent workers, max 10 starved every read behind the completes'
// held transaction connections (overview p50 6s at ~22% CPU and an idle
// database); 30 clears it. Staging re-verifies per PLAN §14.4.
export const DEFAULT_PG_POOL_MAX = 30;

// An unset-but-present PG_POOL_MAX (a valueless flag, an empty .env line) makes
// Number() return 0 or NaN, which pg silently replaces with its own default of
// 10 - the measured starvation number. Same clamp shape as the auth limiters
// (apps/api/src/auth/nest/auth.controller.ts).
export function resolvePoolMax(env: NodeJS.ProcessEnv): number {
  const max = Number(env["PG_POOL_MAX"] ?? DEFAULT_PG_POOL_MAX);
  return Number.isInteger(max) && max > 0 ? max : DEFAULT_PG_POOL_MAX;
}

// The transaction context: inside withLock/withTransaction every port call
// joins the same client (and therefore the same transaction); outside, each
// call uses the pool in autocommit. This is what makes existing service
// critical sections atomic and cross-process safe without service edits.
export class PgContext {
  private pool: Pool;
  private als = new AsyncLocalStorage<PoolClient>();
  // Local contenders for the same logical lock queue here before touching the
  // PostgreSQL pool. PostgreSQL remains the cross-process authority, but one
  // app instance no longer burns N pool clients waiting on the same advisory
  // lock.
  private lockTails = new Map<string, Promise<void>>();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: resolvePoolMax(process.env) });
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
    if (held) {
      // Nested service operations still need their own logical lock. Reuse
      // the outer transaction/client so all effects remain atomic, but acquire
      // the requested advisory xact lock before entering the nested body.
      await held.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      return fn();
    }
    const prior = this.lockTails.get(key) ?? Promise.resolve();
    let releaseLocal!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLocal = resolve;
    });
    const tail = prior.then(() => gate);
    this.lockTails.set(key, tail);
    await prior;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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
      releaseLocal();
      if (this.lockTails.get(key) === tail) this.lockTails.delete(key);
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

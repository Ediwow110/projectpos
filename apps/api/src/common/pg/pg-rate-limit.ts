import { nid } from "./context";
import type { PgContext } from "./context";
import type { RateLimitBackend } from "../rate-limit";

// Cross-process sliding-window limiter over one table. Concurrent hits on
// the same key serialize on a per-key advisory lock inside one transaction,
// so the recorded hit is always counted — the count is exact, mirroring the
// single-threaded memory backend. Rows for keys never hit again linger until
// their next hit prunes them; bounded by distinct keys and the widest window.
export class PgRateLimitBackend implements RateLimitBackend {
  constructor(private readonly ctx: PgContext) {}

  async hitAndCount(key: string, now: number, windowMs: number): Promise<number> {
    return this.ctx.withTransaction(async () => {
      const c = await this.ctx.client();
      // The limiter is called outside service critical sections, so this
      // transaction owns its client and the lock releases at COMMIT.
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rate-limit:${key}`]);
      await c.query('DELETE FROM "RateLimitHit" WHERE "key" = $1 AND "at" < $2', [
        key,
        new Date(now - windowMs),
      ]);
      await c.query('INSERT INTO "RateLimitHit" ("id", "key", "at") VALUES ($1, $2, $3)', [
        nid("rl"),
        key,
        new Date(now),
      ]);
      const r = await c.query(
        'SELECT count(*)::int AS n FROM "RateLimitHit" WHERE "key" = $1 AND "at" >= $2',
        [key, new Date(now - windowMs)],
      );
      return r.rows[0]!.n as number;
    });
  }
}

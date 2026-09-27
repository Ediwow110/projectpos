import { nid } from "./context";
import type { PgContext } from "./context";
import type { RateLimitBackend } from "../rate-limit";

// Cross-process sliding-window limiter over one table, lock-free. Each hit is
// three autocommit statements (prune, insert, count) on a pool client — no
// advisory lock, no explicit transaction: the measured growth cohort showed
// a per-key lock serializing money commands behind the limiter itself while
// pinning pool connections. Exactness trade: a count can miss concurrent
// in-flight inserts for the same key, so the boundary may admit a hit or two
// extra under exact concurrency. For an abuse brake (login 5/min, money
// 1000/min) that slack is acceptable and documented; overcounting was never
// produced because inserts always commit before their own count.
export class PgRateLimitBackend implements RateLimitBackend {
  constructor(private readonly ctx: PgContext) {}

  async hitAndCount(key: string, now: number, windowMs: number): Promise<number> {
    const c = await this.ctx.client();
    try {
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
    } finally {
      if (this.ctx.owns()) c.release();
    }
  }
}

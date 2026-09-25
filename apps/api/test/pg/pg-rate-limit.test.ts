import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";
import { PgRateLimitBackend } from "../../src/common/pg/pg-rate-limit";

describe("phase12 pg rate limit backend", () => {
  it("counts identically to the memory contract and prunes old rows", async () => {
    await withPg(async (_db, ctx) => {
      const backend = new PgRateLimitBackend(ctx);
      const key = `rl-${Date.now()}`;
      const now = Date.now();
      // limit 2: first two hits allowed, third over.
      expect(await backend.hitAndCount(key, now, 60_000)).toBe(1);
      expect(await backend.hitAndCount(key, now + 1, 60_000)).toBe(2);
      expect(await backend.hitAndCount(key, now + 2, 60_000)).toBe(3);
      // Old rows are pruned by the next hit: outside the window the count
      // restarts.
      expect(await backend.hitAndCount(key, now + 61_000, 60_000)).toBe(1);
      // Keys are independent.
      expect(await backend.hitAndCount(`${key}-other`, now, 60_000)).toBe(1);
    });
  });

  it("is safe under concurrent hits (overcounting is the safe direction)", async () => {
    await withPg(async (_db, ctx) => {
      const backend = new PgRateLimitBackend(ctx);
      const key = `rl-conc-${Date.now()}`;
      const now = Date.now();
      const counts = await Promise.all(
        Array.from({ length: 5 }, () => backend.hitAndCount(key, now, 60_000)),
      );
      // Every concurrent hit records; the max count seen reaches 5.
      expect(Math.max(...counts)).toBe(5);
    });
  });
});

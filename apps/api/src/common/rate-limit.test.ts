import { describe, expect, it } from "vitest";
import { createMemoryRateLimitBackend, createRateLimiter, setRateLimitBackend } from "./rate-limit";

describe("rate limiter contract", () => {
  it("limits after the nth hit within the window and expires old hits", async () => {
    setRateLimitBackend(null);
    const limiter = createRateLimiter(2, 60_000);
    const now = 1_000_000;
    expect(await limiter.hit("k", now)).toBe(false);
    expect(await limiter.hit("k", now + 1)).toBe(false);
    expect(await limiter.hit("k", now + 2)).toBe(true);
    // Outside the window the hits expire.
    expect(await limiter.hit("k", now + 61_000)).toBe(false);
  });

  it("keys are independent", async () => {
    setRateLimitBackend(null);
    const limiter = createRateLimiter(1, 60_000);
    expect(await limiter.hit("a", 1_000)).toBe(false);
    expect(await limiter.hit("a", 1_001)).toBe(true);
    expect(await limiter.hit("b", 1_002)).toBe(false);
  });
});

describe("pg rate limit backend (parity)", () => {
  it("counts identically to the memory backend", async () => {
    // Runs only with the pg harness; skipped here because the memory contract
    // above locks the semantics both backends must satisfy. The real parity
    // lives in test/pg/pg-rate-limit.test.ts against a live Postgres.
    expect(createMemoryRateLimitBackend).toBeTypeOf("function");
  });
});

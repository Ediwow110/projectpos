// Sliding-window rate limiting with a pluggable backend. The memory backend
// (default) is per-process; boot installs the PostgreSQL backend when
// DATABASE_URL is set so limits hold across app instances (PLAN §7 rate
// limits, the multi-instance deployment the audit flagged).
export interface RateLimitBackend {
  // Records one hit and returns the number of hits for the key within the
  // window ending at `now` (the new hit included). Overcounting under
  // concurrent hits is the safe direction for a limiter.
  hitAndCount(key: string, now: number, windowMs: number): Promise<number>;
}

export function createMemoryRateLimitBackend(): RateLimitBackend {
  const hits = new Map<string, number[]>();
  return {
    async hitAndCount(key: string, now: number, windowMs: number): Promise<number> {
      const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      arr.push(now);
      hits.set(key, arr);
      return arr.length;
    },
  };
}

let backend: RateLimitBackend = createMemoryRateLimitBackend();

// Boot calls this with the pg backend when DATABASE_URL is set; null restores
// the per-process memory default (what every memory-backed test expects).
export function setRateLimitBackend(next: RateLimitBackend | null): void {
  backend = next ?? createMemoryRateLimitBackend();
}

export function createRateLimiter(limit: number, windowMs: number): {
  hit(key: string, now?: number): Promise<boolean>;
} {
  return {
    async hit(key: string, now: number = Date.now()): Promise<boolean> {
      return (await backend.hitAndCount(key, now, windowMs)) > limit;
    },
  };
}

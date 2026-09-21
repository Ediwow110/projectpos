export function createRateLimiter(limit: number, windowMs: number): {
  hit(key: string, now?: number): boolean;
} {
  const hits = new Map<string, number[]>();
  return {
    hit(key: string, now: number = Date.now()): boolean {
      const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      arr.push(now);
      hits.set(key, arr);
      return arr.length > limit;
    },
  };
}

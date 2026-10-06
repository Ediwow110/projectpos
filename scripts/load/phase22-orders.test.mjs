import { describe, expect, it } from "vitest";
import { errorRate, percentile, redactSample, summarize } from "./phase22-orders.mjs";

describe("phase22 Order load harness", () => {
  it("reports deterministic p50/p95/p99 and error rate", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([10, 20, 30, 40], 99)).toBe(40);
    expect(errorRate(10, 2)).toBe(0.2);
    expect(summarize({ catalog: [10, 20, 30] }, { catalog: 1 }).catalog).toEqual({
      count: 4,
      successCount: 3,
      failures: 1,
      errorRate: 0.25,
      p50Ms: 20,
      p95Ms: 30,
      p99Ms: 30,
    });
  });

  it("redacts credentials, contact data, URLs, storefront/status-like secrets, and tokens from failure samples", () => {
    const value = redactSample(
      "POST https://example.test/order owner@example.test +639171234567 token=" + "a".repeat(64) + " key=" + "b".repeat(32),
    );
    expect(value).not.toContain("https://");
    expect(value).not.toContain("owner@example.test");
    expect(value).not.toContain("+639171234567");
    expect(value).not.toContain("a".repeat(64));
    expect(value).not.toContain("b".repeat(32));
  });
});

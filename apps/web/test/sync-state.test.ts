import { describe, expect, it } from "vitest";

describe("phase9b sync state", () => {
  it("steps backoff 5s, 30s, 5min, then manual", async () => {
    const { backoffDelayMs } = await import("../src/lib/sync-state");
    expect(backoffDelayMs(0)).toBe(5000);
    expect(backoffDelayMs(1)).toBe(30000);
    expect(backoffDelayMs(2)).toBe(300000);
    expect(backoffDelayMs(3)).toBeNull();
    expect(backoffDelayMs(99)).toBeNull();
  });
  it("classifies replay outcomes by status and code", async () => {
    const { classifyReplay, nextSyncState } = await import("../src/lib/sync-state");
    expect(nextSyncState(classifyReplay(200, null))).toBe("SYNCED");
    expect(nextSyncState(classifyReplay(201, null))).toBe("SYNCED");
    expect(nextSyncState(classifyReplay(409, "INSUFFICIENT_STOCK"))).toBe("CONFLICT");
    expect(nextSyncState(classifyReplay(409, "IDEMPOTENCY_MISMATCH"))).toBe("CONFLICT");
    expect(nextSyncState(classifyReplay(403, "FORBIDDEN"))).toBe("CONFLICT");
    expect(nextSyncState(classifyReplay(409, "SHIFT_NO_OPEN_SHIFT"))).toBe("CONFLICT");
    expect(nextSyncState(classifyReplay(503, null))).toBe("FAILED");
    expect(nextSyncState(classifyReplay(429, "RATE_LIMITED"))).toBe("FAILED");
  });
  it("formats provisional receipts and rejects bad hex", async () => {
    const { provisionalReceipt } = await import("../src/lib/sync-state");
    expect(provisionalReceipt("abcdef12")).toBe("OFFLINE-abcdef12");
    expect(() => provisionalReceipt("xyz")).toThrow("VALIDATION");
    expect(() => provisionalReceipt("ABCDEF12")).toThrow("VALIDATION");
  });
  it("flags clock skew beyond the threshold", async () => {
    const { skewWarning } = await import("../src/lib/sync-state");
    const now = Date.parse("2026-09-24T00:00:00.000Z");
    expect(skewWarning("2026-09-24T00:00:00.000Z", now)).toBe(false);
    expect(skewWarning("2026-09-24T00:06:00.000Z", now)).toBe(true);
    expect(skewWarning("2026-09-23T23:54:00.000Z", now)).toBe(true);
    expect(() => skewWarning("not-a-date", now)).toThrow("VALIDATION");
  });
  it("fingerprints stably regardless of key order", async () => {
    const { fingerprintPayload } = await import("../src/lib/sync-state");
    const a = await fingerprintPayload({ saleId: "s1", qty: 2, nested: { b: 1, a: 2 } });
    const b = await fingerprintPayload({ nested: { a: 2, b: 1 }, qty: 2, saleId: "s1" });
    const c = await fingerprintPayload({ saleId: "s1", qty: 3, nested: { b: 1, a: 2 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

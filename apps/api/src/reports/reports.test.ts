import { describe, expect, it } from "vitest";
import {
  bucketKey, bucketRange, compareLabel, delta, isSettled, previousRange, resolveRange,
} from "./aggregate";

describe("phase7 reporting domain", () => {
  it("filters to settled states only", () => {
    expect(isSettled("COMPLETED")).toBe(true);
    expect(isSettled("PARTIALLY_REFUNDED")).toBe(true);
    expect(isSettled("REFUNDED")).toBe(true);
    expect(isSettled("VOIDED")).toBe(false);
    expect(isSettled("PAYMENT_UNKNOWN")).toBe(false);
    expect(isSettled("DRAFT")).toBe(false);
  });
  it("defaults to the last 30 days and rejects bad ranges", () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    const r = resolveRange(undefined, undefined, now);
    expect(r.to.getTime() - r.from.getTime()).toBe(30 * 24 * 3600 * 1000);
    expect(() => resolveRange("not-a-date", undefined, now)).toThrow("VALIDATION");
    expect(() => resolveRange("2026-09-23T00:00:00.000Z", "2026-09-01T00:00:00.000Z", now)).toThrow("VALIDATION");
    expect(() => resolveRange("2020-01-01T00:00:00.000Z", "2026-09-23T00:00:00.000Z", now)).toThrow("VALIDATION");
  });
  it("computes previous ranges and labels", () => {
    const r = resolveRange("2026-09-01T00:00:00.000Z", "2026-09-11T00:00:00.000Z");
    const prev = previousRange(r, "previous_period")!;
    expect(prev.to.getTime()).toBe(r.from.getTime());
    expect(previousRange(r, "none")).toBeNull();
    expect(compareLabel(r, "previous_period")).toBe("vs previous 10 days");
    expect(compareLabel(r, "none")).toBe("no comparison");
  });
  it("buckets days and hours in UTC", () => {
    expect(bucketKey(new Date("2026-09-05T15:30:00.000Z"), "day")).toBe("2026-09-05");
    expect(bucketKey(new Date("2026-09-05T15:30:00.000Z"), "hour")).toBe("2026-09-05T15");
    expect(bucketRange(new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-03T00:00:00.000Z"), "day"))
      .toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });
  it("computes deltas with null pct on zero base", () => {
    expect(delta(120, 100)).toEqual({ deltaMinor: 20, deltaPct: 20 });
    expect(delta(50, 0)).toEqual({ deltaMinor: 50, deltaPct: null });
  });
});

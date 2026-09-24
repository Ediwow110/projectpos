import { describe, expect, it } from "vitest";
import { isPlanLimit, trialDaysLeft, usagePct } from "../src/lib/billing";

describe("phase10 billing web helpers", () => {
  it("detects plan-limit errors", () => {
    expect(isPlanLimit("PLAN_LIMIT")).toBe(true);
    expect(isPlanLimit("VALIDATION")).toBe(false);
    expect(isPlanLimit("")).toBe(false);
  });
  it("counts trial days left", () => {
    const now = Date.parse("2026-09-24T00:00:00.000Z");
    expect(trialDaysLeft(new Date(now + 86400000).toISOString(), now)).toBe(1);
    expect(trialDaysLeft(new Date(now + 14 * 86400000).toISOString(), now)).toBe(14);
    expect(trialDaysLeft(new Date(now - 1000).toISOString(), now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBeNull();
  });
  it("computes usage percentages with null-safe limits", () => {
    expect(usagePct(50, 100)).toBe(50);
    expect(usagePct(150, 100)).toBe(100);
    expect(usagePct(0, 100)).toBe(0);
    expect(usagePct(5, null)).toBeNull();
    expect(usagePct(1, 0)).toBe(100);
    expect(usagePct(0, 0)).toBe(0);
  });
});

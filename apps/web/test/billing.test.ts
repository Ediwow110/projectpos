import { describe, expect, it } from "vitest";
import { errorText, isPlanLimit, planLimitNotice, trialDaysLeft, usagePct } from "../src/lib/billing";
import { ApiError } from "../src/lib/api";

describe("phase10 billing web helpers", () => {
  it("detects plan-limit errors", () => {
    expect(isPlanLimit("PLAN_LIMIT")).toBe(true);
    expect(isPlanLimit("VALIDATION")).toBe(false);
    expect(isPlanLimit("")).toBe(false);
  });
  it("turns a plan-limit envelope into an upgrade notice", () => {
    const capped = new ApiError("PLAN_LIMIT", "Plan change failed", "req-1", 402, {
      limit: ["3"],
      used: ["3"],
      plan: ["free"],
      resource: ["registers"],
    });
    expect(planLimitNotice(capped)).toEqual({
      plan: "free",
      limit: "3",
      used: "3",
      resource: "registers",
      message: "Register limit reached on the Free plan (3 of 3 used).",
    });
    const feature = new ApiError("PLAN_LIMIT", "Feature gate failed", "req-2", 402, {
      feature: ["reports"],
      plan: ["free"],
    });
    expect(planLimitNotice(feature)).toEqual({
      plan: "free",
      limit: null,
      used: null,
      resource: "reports",
      message: "Reports is not included in the Free plan.",
    });
    expect(planLimitNotice(new ApiError("VALIDATION", "nope", "r", 400))).toBeNull();
    expect(planLimitNotice(new Error("boom"))).toBeNull();
  });
  it("keeps machine fields on ApiError", () => {
    const err = new ApiError("PLAN_LIMIT", "m", "c", 402, { plan: ["pro"] });
    expect(err.fields).toEqual({ plan: ["pro"] });
    expect(err.status).toBe(402);
  });
  it("prefers the upgrade copy over the raw code", () => {
    const capped = new ApiError("PLAN_LIMIT", "Product create failed", "r", 402, {
      limit: ["100"], used: ["100"], plan: ["free"], resource: ["products"],
    });
    expect(errorText(capped, "Create failed")).toBe(
      "Product limit reached on the Free plan (100 of 100 used).",
    );
    expect(errorText(new ApiError("VALIDATION", "bad name", "r", 400), "Create failed")).toBe(
      "VALIDATION: bad name",
    );
    expect(errorText(new Error("socket hang up"), "Create failed")).toBe("Create failed");
  });
  it("counts trial days left", () => {
    const now = Date.parse("2026-09-24T00:00:00.000Z");
    expect(trialDaysLeft(new Date(now + 86400000).toISOString(), now)).toBe(1);
    expect(trialDaysLeft(new Date(now + 14 * 86400000).toISOString(), now)).toBe(14);
    expect(trialDaysLeft(new Date(now - 1000).toISOString(), now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBeNull();
  });
  it("refuses to count down from a trial date the server did not send readably", () => {
    expect(trialDaysLeft("00:00:00", Date.now())).toBeNull();
    expect(trialDaysLeft("not-a-date", Date.now())).toBeNull();
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

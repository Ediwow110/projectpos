import { describe, expect, it } from "vitest";

describe("phase7 reports web helpers", () => {
  it("builds an overview query string with defaults", async () => {
    const { buildOverviewQuery } = await import("../src/lib/reports");
    expect(buildOverviewQuery({})).toBe("/api/v1/dashboard/overview?compare=previous_period");
    expect(buildOverviewQuery({ dateFrom: "2026-09-01", compare: "none" })).toBe(
      "/api/v1/dashboard/overview?dateFrom=2026-09-01&compare=none",
    );
  });
  it("formats deltas in words and numbers", async () => {
    const { formatDelta } = await import("../src/lib/reports");
    expect(formatDelta({ deltaMinor: 2000, deltaPct: 20 }, "vs previous 30 days")).toBe(
      "▲ 20.00 (▲ 20%) vs previous 30 days",
    );
    expect(formatDelta({ deltaMinor: -500, deltaPct: null }, "no comparison")).toBe(
      "▼ 5.00 (n/a) no comparison",
    );
  });
  it("hides profit metrics without the key", async () => {
    const { availableMetrics } = await import("../src/lib/reports");
    expect(availableMetrics({ netRevenue: {}, orders: {} })).toEqual(["revenue", "orders", "avg"]);
    expect(availableMetrics({ netRevenue: {}, orders: {}, grossProfit: {} })).toContain("profit");
  });
});

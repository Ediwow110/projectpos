import { describe, expect, it } from "vitest";

import { attentionRows, dashboardKpi, dashboardSeries } from "./dashboard-view";

describe("dashboard view model", () => {
  it("keeps unavailable gross profit unavailable instead of inventing zero", () => {
    const result = dashboardKpi({ netRevenue: { value: 100 } }, "grossProfit");
    expect(result).toBeNull();
  });

  it("keeps an empty series empty", () => {
    expect(dashboardSeries([], "revenue")).toEqual([]);
  });

  it("preserves attention labels, hrefs, and counts from the API", () => {
    const rows = attentionRows([
      { kind: "low_stock", label: "Low stock", href: "/inventory", count: 4 },
    ]);
    expect(rows).toEqual([
      { kind: "low_stock", label: "Low stock", href: "/inventory", count: 4 },
    ]);
  });
});

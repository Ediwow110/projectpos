import { describe, expect, it } from "vitest";

import { branchShares, categorySeries, paymentMix, reportSeries } from "./report-view";

describe("report view transformations", () => {
  it("calculates payment mix percentages from real totals", () => {
    expect(paymentMix([
      { method: "cash", total: 700, count: 7 },
      { method: "card", total: 300, count: 3 },
    ])).toEqual([
      { label: "Cash", value: 700, count: 7, sharePct: 70 },
      { label: "Card", value: 300, count: 3, sharePct: 30 },
    ]);
  });

  it("normalizes branch shares safely when totals are zero", () => {
    expect(branchShares([{ name: "Main", sales: 0, orders: 0 }])).toEqual([
      { label: "Main", sales: 0, orders: 0, sharePct: 0 },
    ]);
  });

  it("keeps an empty time series empty", () => {
    expect(reportSeries([], "revenue")).toEqual([]);
  });

  it("marks unsupported category data unavailable instead of inventing values", () => {
    expect(categorySeries(undefined)).toBeNull();
  });
});

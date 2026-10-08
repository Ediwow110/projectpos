import { describe, expect, it } from "vitest";

import type { SaleWithLines } from "./reporting-core";
import { revenueSeries } from "./reporting-series";

function sale(at: string, totalMinor: number, refunded: number): SaleWithLines {
  return {
    sale: { createdAt: new Date(at), totalMinor } as SaleWithLines["sale"],
    items: [],
    refunded,
    merchandiseRefunded: refunded,
    deliveryRefunded: 0,
    refundedCost: 0,
    giftLoadMinor: 0,
    merchandiseRevenue: totalMinor,
    deliveryRevenue: 0,
    deliveryTax: 0,
    netRevenue: totalMinor - refunded,
  };
}

describe("reporting revenue series", () => {
  it("uses Phase 22 accounting net revenue rather than gross sale minus refunds", () => {
    const withDeliveryAndGiftLoad = {
      ...sale("2026-10-01T10:00:00Z", 8000, 1000),
      giftLoadMinor: 2000,
      deliveryRevenue: 500,
      deliveryTax: 50,
      netRevenue: 5050,
    };
    expect(revenueSeries(["2026-10-01"], "day", [withDeliveryAndGiftLoad]))
      .toEqual([{ bucket: "2026-10-01", netRevenue: 5050, orders: 1 }]);
  });
  it("seeds ordered day buckets including empty buckets and ignores outside sales", () => {
    const buckets = ["2026-10-01", "2026-10-02", "2026-10-03"];
    const result = revenueSeries(buckets, "day", [
      sale("2026-10-01T10:00:00Z", 5000, 1000),
      sale("2026-10-01T22:00:00Z", 2000, 200),
      sale("2026-10-03T03:00:00Z", 3000, 0),
      sale("2026-09-30T23:00:00Z", 4000, 0),
    ]);
    expect(result).toEqual([
      { bucket: "2026-10-01", netRevenue: 5800, orders: 2 },
      { bucket: "2026-10-02", netRevenue: 0, orders: 0 },
      { bucket: "2026-10-03", netRevenue: 3000, orders: 1 },
    ]);
    expect(buckets).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("keeps separate UTC hour buckets with refund subtraction", () => {
    expect(revenueSeries(["2026-10-01T09", "2026-10-01T10"], "hour", [
      sale("2026-10-01T09:59:59Z", 750, 800),
      sale("2026-10-01T10:00:00Z", 2500, 200),
    ])).toEqual([
      { bucket: "2026-10-01T09", netRevenue: -50, orders: 1 },
      { bucket: "2026-10-01T10", netRevenue: 2300, orders: 1 },
    ]);
  });

  it("returns no buckets if the range has no buckets", () => {
    expect(revenueSeries([], "day", [sale("2026-10-01T10:00:00Z", 100, 0)])).toEqual([]);
  });
});

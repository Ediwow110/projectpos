import { bucketKey } from "./aggregate";
import type { SaleWithLines, SeriesPoint } from "./reporting-core";

/**
 * Shared revenue-series projection for the overview and sales report.
 * The caller owns date-range resolution and tenant/branch/register filtering.
 */
export function revenueSeries(
  buckets: string[],
  granularity: "day" | "hour",
  sales: SaleWithLines[],
): SeriesPoint[] {
  const byBucket = new Map<string, { netRevenue: number; orders: number }>();
  for (const bucket of buckets) {
    byBucket.set(bucket, { netRevenue: 0, orders: 0 });
  }
  for (const sale of sales) {
    const slot = byBucket.get(bucketKey(sale.sale.createdAt, granularity));
    if (!slot) continue;
    // Phase 22 net revenue excludes gift-card loads and incorporates
    // merchandise, delivery, tax and related refunds via ReportingCore.
    slot.netRevenue += sale.netRevenue;
    slot.orders += 1;
  }
  return buckets.map((bucket) => ({ bucket, ...byBucket.get(bucket)! }));
}

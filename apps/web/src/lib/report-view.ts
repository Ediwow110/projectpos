export interface PaymentMethodRow {
  method: string;
  total: number;
  count: number;
}

export interface BranchReportRow {
  name: string;
  sales: number;
  orders: number;
}

export interface ReportSeriesPoint {
  bucket: string;
  netRevenue: number;
  orders: number;
}

function labelize(value: string): string {
  if (value.length === 0) return value;
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

export function paymentMix(rows: PaymentMethodRow[]): Array<{
  label: string;
  value: number;
  count: number;
  sharePct: number;
}> {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.total), 0);
  return rows.map((row) => ({
    label: labelize(row.method),
    value: Math.max(0, row.total),
    count: Math.max(0, row.count),
    sharePct: total <= 0 ? 0 : Math.round((Math.max(0, row.total) / total) * 100),
  }));
}

export function branchShares(rows: BranchReportRow[]): Array<{
  label: string;
  sales: number;
  orders: number;
  sharePct: number;
}> {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.sales), 0);
  return rows.map((row) => ({
    label: row.name,
    sales: Math.max(0, row.sales),
    orders: Math.max(0, row.orders),
    sharePct: total <= 0 ? 0 : Math.round((Math.max(0, row.sales) / total) * 100),
  }));
}

export function reportSeries(
  rows: ReportSeriesPoint[],
  metric: "revenue" | "orders",
): Array<{ label: string; value: number }> {
  return rows.map((row) => ({
    label: row.bucket,
    value: metric === "orders" ? Math.max(0, row.orders) : Math.max(0, row.netRevenue),
  }));
}

export function categorySeries(
  rows: Array<{ label: string; value: number }> | undefined,
): Array<{ label: string; value: number }> | null {
  if (rows === undefined) return null;
  return rows.map((row) => ({ label: row.label, value: Math.max(0, row.value) }));
}

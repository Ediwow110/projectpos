export interface DashboardKpi {
  value: number;
  previous?: number | null;
  deltaMinor?: number | null;
  deltaPct?: number | null;
}

export interface DashboardSeriesPoint {
  bucket: string;
  netRevenue: number;
  orders: number;
}

export interface DashboardAttention {
  kind: string;
  label: string;
  href: string;
  count: number;
}

export function dashboardKpi(
  kpis: Record<string, DashboardKpi | undefined>,
  key: string,
): DashboardKpi | null {
  return kpis[key] ?? null;
}

export function dashboardSeries(
  series: DashboardSeriesPoint[],
  metric: "revenue" | "orders",
): Array<{ bucket: string; value: number }> {
  return series.map((point) => ({
    bucket: point.bucket,
    value: metric === "orders" ? point.orders : point.netRevenue,
  }));
}

export function attentionRows(rows: DashboardAttention[]): DashboardAttention[] {
  return rows.map((row) => ({ ...row }));
}

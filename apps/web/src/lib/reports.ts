export function buildOverviewQuery(params: {
  dateFrom?: string;
  dateTo?: string;
  compare?: string;
  registerId?: string;
  branchId?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  sp.set("compare", params.compare ?? "previous_period");
  if (params.registerId) sp.set("registerId", params.registerId);
  if (params.branchId) sp.set("branchId", params.branchId);
  return `/api/v1/dashboard/overview?${sp.toString()}`;
}

export function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function formatDelta(
  d: { deltaMinor: number; deltaPct: number | null },
  label: string,
): string {
  const arrow = d.deltaMinor >= 0 ? "▲" : "▼";
  const pct = d.deltaPct === null ? "n/a" : `${arrow} ${d.deltaPct}%`;
  return `${arrow} ${money(Math.abs(d.deltaMinor))} (${pct}) ${label}`;
}

export function availableMetrics(kpis: Record<string, unknown>): string[] {
  const out = ["revenue", "orders", "avg"];
  if ("grossProfit" in kpis) out.push("profit");
  return out;
}

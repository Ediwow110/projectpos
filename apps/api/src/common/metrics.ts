// §14.2: process-local counters for the metric families the runbooks name.
// Prometheus text exposition format, no dependencies. Counters are process
// global; a shared backend belongs with the Prisma port (Phase 12).
const counters = new Map<string, number>();

function metricLabel(value: string): string {
  return value.slice(0, 96).replace(/[\\"\n\r]/g, "_");
}

export function incrementMetric(name: string, labels: Record<string, string> = {}): void {
  const key = `${name}${Object.keys(labels).length ? `{${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${metricLabel(v)}"`).join(",")}}` : ""}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function recordCriticalOutcome(domain: "sales" | "payment" | "refund" | "inventory" | "stored_value", outcome: string): void {
  incrementMetric(`pos_${domain}_outcomes_total`, { outcome });
}

export function renderMetrics(): string {
  const lines = [...counters.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`);
  return `${lines.join("\n")}\n`;
}

export function resetMetricsForTests(): void {
  counters.clear();
}

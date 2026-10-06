// §14.2: process-local counters for the metric families the runbooks name.
// Prometheus text exposition format, no dependencies. Counters are process
// global; a shared backend belongs with the Prisma port (Phase 12).
const counters = new Map<string, number>();

function metricLabel(value: string): string {
  const normalized = value.slice(0, 160);
  const sensitive =
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(normalized)
    || /\+?\d[\d\s().-]{6,}\d/.test(normalized)
    || /\b[a-f0-9]{32,}\b/i.test(normalized)
    || /\b[A-Za-z0-9_-]{40,}\b/.test(normalized)
    || /(password|secret|token|cookie|authorization|address|instruction|note|payload)\s*[=:]/i.test(normalized);
  if (sensitive) return "[REDACTED]";
  return normalized.slice(0, 96).replace(/[\\"\n\r]/g, "_");
}

function metricKey(name: string, labels: Record<string, string> = {}): string {
  return `${name}${Object.keys(labels).length ? `{${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${metricLabel(v)}"`).join(",")}}` : ""}`;
}

export function incrementMetric(name: string, labels: Record<string, string> = {}): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function setMetric(name: string, value: number, labels: Record<string, string> = {}): void {
  if (!Number.isFinite(value)) throw new Error("METRIC_VALUE_INVALID");
  counters.set(metricKey(name, labels), value);
}

export function recordCriticalOutcome(domain: "sales" | "payment" | "refund" | "inventory" | "stored_value", outcome: string): void {
  incrementMetric(`pos_${domain}_outcomes_total`, { outcome });
}

export function recordOrderLifecycle(channel: "WEB" | "POS", status: string): void {
  incrementMetric("pos_order_lifecycle_total", { channel, status });
}

export function recordReservationOutcome(outcome: "held" | "released" | "expired" | "committed" | "conflict"): void {
  incrementMetric("pos_order_reservation_outcomes_total", { outcome });
}

export function recordFulfillmentOutcome(type: "PICKUP" | "DELIVERY", status: string, durationMs?: number): void {
  incrementMetric("pos_order_fulfillment_outcomes_total", { type, status });
  if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0) {
    const bucket = durationMs < 60_000 ? "lt1m" : durationMs < 15 * 60_000 ? "lt15m" : durationMs < 60 * 60_000 ? "lt1h" : "gte1h";
    incrementMetric("pos_order_fulfillment_transition_latency_bucket_total", { type, status, bucket });
  }
}

export function recordPaymentHandoff(outcome: "started" | "failed" | "unknown" | "reconciled"): void {
  incrementMetric("pos_order_payment_handoff_total", { outcome });
}

export function recordGuestAccess(outcome: "failure" | "revoked"): void {
  incrementMetric("pos_order_guest_access_total", { outcome });
}

export function recordIdempotencyConflict(domain: "order" | "reservation" | "fulfillment" | "payment"): void {
  incrementMetric("pos_order_idempotency_conflicts_total", { domain });
}

export function recordSaleChannel(channel: "WEB" | "POS"): void {
  incrementMetric("pos_sale_completion_channel_total", { channel });
}

export function renderMetrics(): string {
  const lines = [...counters.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`);
  return `${lines.join("\n")}\n`;
}

export function resetMetricsForTests(): void {
  counters.clear();
}

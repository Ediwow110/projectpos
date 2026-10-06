import { describe, expect, it } from "vitest";
import {
  incrementMetric,
  recordCriticalOutcome,
  renderMetrics,
  resetMetricsForTests,
  setMetric,
} from "./metrics";

describe("phase11 metrics", () => {
  it("counts and renders labeled counters", () => {
    resetMetricsForTests();
    incrementMetric("pos_sales_completed_total");
    incrementMetric("pos_http_requests_total", { method: "POST", status: "201" });
    incrementMetric("pos_http_requests_total", { method: "POST", status: "201" });
    const text = renderMetrics();
    expect(text).toContain("pos_sales_completed_total 1");
    expect(text).toContain('pos_http_requests_total{method="POST",status="201"} 2');
  });

  it("escapes labels and records critical operation outcomes", () => {
    resetMetricsForTests();
    incrementMetric("pos_http_requests_total", { route: "/x\"\n", status: "500" });
    recordCriticalOutcome("stored_value", "rejected");
    const text = renderMetrics();
    expect(text).toContain('route="/x__"');
    expect(text).toContain('pos_stored_value_outcomes_total{outcome="rejected"} 1');
  });

  it("redacts sensitive label content and supports current-state gauges", () => {
    resetMetricsForTests();
    incrementMetric("pos_order_guest_access_failures_total", {
      outcome: "denied",
      detail: "owner@example.com +639171234567 token=" + "a".repeat(64),
    });
    setMetric("pos_order_aged_operational_holds", 3);
    const text = renderMetrics();
    expect(text).toContain("pos_order_aged_operational_holds 3");
    expect(text).not.toContain("owner@example.com");
    expect(text).not.toContain("+639171234567");
    expect(text).not.toContain("a".repeat(64));
  });

  it("redacts raw base64url bearer-like label values", () => {
    resetMetricsForTests();
    const raw = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";
    incrementMetric("pos_order_guest_access_total", { detail: raw });
    expect(renderMetrics()).not.toContain(raw);
  });
});

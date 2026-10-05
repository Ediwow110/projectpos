import { describe, expect, it } from "vitest";
import { incrementMetric, recordCriticalOutcome, renderMetrics, resetMetricsForTests } from "./metrics";

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
});

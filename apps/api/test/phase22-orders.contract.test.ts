import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import {
  incrementMetric,
  recordFulfillmentOutcome,
  recordGuestAccess,
  recordIdempotencyConflict,
  recordOrderLifecycle,
  recordPaymentHandoff,
  recordReservationOutcome,
  recordSaleChannel,
  resetMetricsForTests,
  setMetric,
} from "../src/common/metrics";

let app: INestApplication;

beforeAll(async () => {
  process.env["METRICS_TOKEN"] = "phase22-metrics-test-token";
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  delete process.env["METRICS_TOKEN"];
});

describe("phase22 order observability contract", () => {
  it("exposes the required low-cardinality metric families without bearer or PII leakage", async () => {
    resetMetricsForTests();
    recordOrderLifecycle("WEB", "SUBMITTED");
    recordReservationOutcome("held");
    recordReservationOutcome("released");
    recordReservationOutcome("expired");
    recordReservationOutcome("committed");
    recordReservationOutcome("conflict");
    setMetric("pos_order_aged_operational_holds", 2);
    recordSaleChannel("WEB");
    recordSaleChannel("POS");
    recordPaymentHandoff("started");
    recordPaymentHandoff("failed");
    recordPaymentHandoff("unknown");
    recordPaymentHandoff("reconciled");
    recordFulfillmentOutcome("DELIVERY", "DELIVERED", 90_000);
    recordIdempotencyConflict("order");
    recordGuestAccess("failure");
    recordGuestAccess("revoked");
    incrementMetric("pos_order_guest_access_failures_total", {
      detail: "owner@example.com +639171234567 token=" + "a".repeat(64) + " address=1 Main St",
    });

    const res = await request(app.getHttpServer())
      .get("/api/v1/metrics")
      .set("Authorization", "Bearer phase22-metrics-test-token");
    expect(res.status).toBe(200);
    const text = String(res.text);
    for (const family of [
      "pos_order_lifecycle_total",
      "pos_order_reservation_outcomes_total",
      "pos_order_aged_operational_holds",
      "pos_sale_completion_channel_total",
      "pos_order_payment_handoff_total",
      "pos_order_fulfillment_outcomes_total",
      "pos_order_fulfillment_transition_latency_bucket_total",
      "pos_order_idempotency_conflicts_total",
      "pos_order_guest_access_total",
    ]) {
      expect(text).toContain(family);
    }
    expect(text).not.toContain("owner@example.com");
    expect(text).not.toContain("+639171234567");
    expect(text).not.toContain("a".repeat(64));
    expect(text).not.toContain("1 Main St");
    expect(text).not.toContain("phase22-metrics-test-token");
  });

  it("keeps metrics bearer-gated", async () => {
    const missing = await request(app.getHttpServer()).get("/api/v1/metrics");
    expect(missing.status).toBe(403);
    const wrong = await request(app.getHttpServer()).get("/api/v1/metrics")
      .set("Authorization", "Bearer wrong");
    expect(wrong.status).toBe(403);
  });
});

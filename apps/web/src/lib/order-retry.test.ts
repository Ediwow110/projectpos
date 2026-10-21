import { describe, expect, it } from "vitest";

import { ApiError } from "./api";

function order(overrides: { status?: string; paymentMode?: string; paymentStatus?: string }) {
  return {
    status: overrides.status ?? "SUBMITTED",
    paymentMode: overrides.paymentMode ?? "PREPAID",
    paymentStatus: overrides.paymentStatus ?? "FAILED",
  } as never;
}

describe("public order payment retry", () => {
  it("offers a retry when a submitted prepaid order has no money moving", async () => {
    const { canRetryPayment } = await import("./order-retry");
    expect(canRetryPayment(order({ paymentStatus: "FAILED" }))).toBe(true);
    expect(canRetryPayment(order({ paymentStatus: "UNPAID" }))).toBe(true);
  });

  it("never offers a retry while a payment is still in flight, because that double-charges", async () => {
    const { canRetryPayment } = await import("./order-retry");
    expect(canRetryPayment(order({ paymentStatus: "PENDING" }))).toBe(false);
    expect(canRetryPayment(order({ paymentStatus: "UNKNOWN" }))).toBe(false);
  });

  it("never offers a retry for money that is already settled or reversed", async () => {
    const { canRetryPayment } = await import("./order-retry");
    expect(canRetryPayment(order({ paymentStatus: "PAID" }))).toBe(false);
    expect(canRetryPayment(order({ paymentStatus: "REFUNDED" }))).toBe(false);
    expect(canRetryPayment(order({ paymentStatus: "PARTIALLY_REFUNDED" }))).toBe(false);
  });

  it("only retries an order the server still accepts a retry for", async () => {
    const { canRetryPayment } = await import("./order-retry");
    expect(canRetryPayment(order({ status: "COMPLETED" }))).toBe(false);
    expect(canRetryPayment(order({ status: "CANCELLED" }))).toBe(false);
    expect(canRetryPayment(order({ status: "EXPIRED" }))).toBe(false);
    expect(canRetryPayment(order({ paymentMode: "POS" }))).toBe(false);
  });

  it("says which browser can retry, because the checkout credential is an httpOnly cookie", async () => {
    const { retryFailureCopy } = await import("./order-retry");
    expect(retryFailureCopy(new ApiError("NOT_FOUND", "not found", "", 404))).toContain("browser that placed the order");
    expect(retryFailureCopy(new ApiError("RATE_LIMITED", "too many", "", 429))).toContain("Wait");
    expect(retryFailureCopy(new ApiError("INVALID_STATE", "state", "", 409))).toContain("Refresh");
  });

  it("keeps an unclassified failure as the server's own code and message", async () => {
    const { retryFailureCopy } = await import("./order-retry");
    expect(retryFailureCopy(new ApiError("PAYMENT_UNAVAILABLE", "Provider not configured", "", 503))).toBe(
      "PAYMENT_UNAVAILABLE: Provider not configured",
    );
  });

  it("refuses to ask before a method is chosen", async () => {
    const { retryRequestBody } = await import("./order-retry");
    expect(retryRequestBody(null)).toBeNull();
    expect(retryRequestBody("qrph")).toEqual({ paymentMethod: "qrph" });
  });

  it("keeps one key per intent, so a repeated click cannot open two checkouts", async () => {
    const { retryIntentFor } = await import("./order-retry");
    const first = retryIntentFor(null, "card");
    expect(retryIntentFor(first, "card")).toEqual(first);
  });

  it("treats a different payment method as a new intent, not a replay", async () => {
    const { retryIntentFor } = await import("./order-retry");
    const card = retryIntentFor(null, "card");
    const gcash = retryIntentFor(card, "gcash");
    expect(gcash.method).toBe("gcash");
    expect(gcash.key).not.toBe(card.key);
  });
});

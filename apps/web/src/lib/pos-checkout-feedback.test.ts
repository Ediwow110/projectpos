import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  checkoutFailureFromError,
  isRetryBlocked,
  posSaleAttemptContext,
  shouldClearCheckoutFailureForNewAttempt,
  tagPosSaleAttempt,
} from "./pos-checkout-feedback";

function apiError(code: string, status: number, message = "Server detail"): ApiError {
  return new ApiError(code, message, "corr-1", status);
}

describe("POS checkout failure contract", () => {
  it("maps INSUFFICIENT_STOCK to a recoverable stock failure without leaking the raw code", () => {
    const failure = checkoutFailureFromError(apiError("INSUFFICIENT_STOCK", 409, "Not enough stock."));

    expect(failure.kind).toBe("stock");
    expect(failure.retryable).toBe(true);
    expect(failure.action).toEqual({ kind: "adjust_cart", label: "Back to sale to adjust" });
    expect(failure.message).toMatch(/stock/i);
    expect(failure.message).not.toContain("INSUFFICIENT_STOCK");
    expect(failure.code).toBe("INSUFFICIENT_STOCK");
    expect(failure.correlationId).toBe("corr-1");
    expect(isRetryBlocked(failure)).toBe(false);
  });

  it("keeps a connection drop retryable without claiming the sale was never sent", () => {
    const failure = checkoutFailureFromError(apiError("NETWORK_ERROR", 0, "Could not reach the API."));

    expect(failure.kind).toBe("connectivity");
    expect(failure.retryable).toBe(true);
    expect(failure.action).toEqual({ kind: "check_connection", label: "Check connection and retry" });
    expect(isRetryBlocked(failure)).toBe(false);
    // The write may have landed, so the copy must not claim otherwise.
    expect(failure.message).not.toMatch(/before the sale was sent/i);
    expect(failure.message).toMatch(/may already be recorded/i);
  });

  it("turns a connection drop after the draft exists into an unknown outcome that blocks blind retry", () => {
    const error = tagPosSaleAttempt(
      apiError("NETWORK_ERROR", 0, "Could not reach the API."),
      { phase: "complete", saleId: "sale-9" },
    );
    const failure = checkoutFailureFromError(error);

    expect(posSaleAttemptContext(error)).toEqual({ phase: "complete", saleId: "sale-9" });
    expect(failure.kind).toBe("unknown_outcome");
    expect(failure.retryable).toBe(false);
    expect(failure.saleId).toBe("sale-9");
    expect(failure.action).toEqual({ kind: "check_sale", label: "Check sale status", href: "/sales/sale-9" });
    expect(failure.message).toMatch(/status unknown/i);
    expect(failure.message).toMatch(/do not retry payment/i);
    expect(isRetryBlocked(failure)).toBe(true);
  });

  it("turns a 500 after the completion request into an unknown outcome with a sale-status link", () => {
    const error = tagPosSaleAttempt(
      apiError("HTTP_ERROR", 500, "Request failed."),
      { phase: "complete", saleId: "sale-500" },
    );
    const failure = checkoutFailureFromError(error);

    expect(failure.kind).toBe("unknown_outcome");
    expect(failure.retryable).toBe(false);
    expect(failure.action).toEqual({ kind: "check_sale", label: "Check sale status", href: "/sales/sale-500" });
  });

  it.each(["PAYMENT_PROVIDER_INVALID_RESPONSE", "PAYMENT_PROVIDER_MISMATCH"])(
    "treats %s as an unknown outcome even when no sale id was attached",
    (code) => {
      const failure = checkoutFailureFromError(apiError(code, code.endsWith("MISMATCH") ? 409 : 502));

      expect(failure.kind).toBe("unknown_outcome");
      expect(failure.retryable).toBe(false);
      expect(failure.action).toEqual({ kind: "check_sale", label: "Check sale status", href: "/sales" });
      expect(failure.message).toMatch(/do not retry payment/i);
      expect(isRetryBlocked(failure)).toBe(true);
    },
  );

  it("links an ambiguous provider response to the recorded sale", () => {
    const error = tagPosSaleAttempt(
      apiError("PAYMENT_PROVIDER_INVALID_RESPONSE", 502, "Provider response was incomplete."),
      { phase: "checkout", saleId: "sale-provider" },
    );
    const failure = checkoutFailureFromError(error);

    expect(failure.kind).toBe("unknown_outcome");
    expect(failure.action).toEqual({
      kind: "check_sale",
      label: "Check sale status",
      href: "/sales/sale-provider",
    });
  });

  it("treats a provider outage as an unknown outcome, because the request may have reached the provider", () => {
    const failure = checkoutFailureFromError(apiError("PAYMENT_PROVIDER_UNAVAILABLE", 503));

    // Once a request has been sent to a provider, NexPOS cannot prove that no
    // money moved. A blind retry is therefore not offered, and the copy must
    // not claim that nothing was charged.
    expect(failure.kind).toBe("unknown_outcome");
    expect(failure.retryable).toBe(false);
    expect(isRetryBlocked(failure)).toBe(true);
    expect(failure.message).not.toMatch(/no payment was taken/i);
    expect(failure.message).not.toMatch(/nothing was charged/i);
  });

  it.each([
    "PAYMENT_PROVIDER_UNAVAILABLE",
    "PAYMENT_PROVIDER_TIMEOUT",
    "PAYMENT_PROVIDER_ERROR",
    "PAYMENT_PROVIDER_INVALID_RESPONSE",
    "PAYMENT_PROVIDER_MISMATCH",
    "PAYMENT_PROVIDER_DOWN",
  ])("never offers a blind retry for the provider code %s", (code) => {
    const failure = checkoutFailureFromError(apiError(code, 503));

    expect(failure.kind).toBe("unknown_outcome");
    expect(failure.retryable).toBe(false);
    expect(isRetryBlocked(failure)).toBe(true);
    expect(failure.message).not.toMatch(/no payment was taken/i);
    expect(failure.message).not.toMatch(/nothing was charged/i);
  });

  it("keeps the PayMongo configuration gap distinct from an ambiguous provider outcome", () => {
    const failure = checkoutFailureFromError(apiError("PAYMENT_PROVIDER_NOT_CONFIGURED", 503));

    expect(failure.kind).toBe("config");
    expect(failure.retryable).toBe(false);
  });

  it("keeps a 500 while the draft was still being created retryable, without claiming the sale was not sent", () => {
    const error = tagPosSaleAttempt(
      apiError("HTTP_ERROR", 500, "Request failed."),
      { phase: "draft", saleId: null },
    );
    const failure = checkoutFailureFromError(error);

    expect(failure.kind).toBe("server");
    expect(failure.retryable).toBe(true);
    expect(failure.action.kind).toBe("retry");
    expect(isRetryBlocked(failure)).toBe(false);
    // The write may have landed, so the copy must not claim otherwise.
    expect(failure.message).not.toMatch(/before the sale was sent/i);
    expect(failure.message).not.toMatch(/nothing was charged/i);
  });

  it("maps FORBIDDEN without a discount to a permission failure without approval copy", () => {
    const failure = checkoutFailureFromError(apiError("FORBIDDEN", 403, "Forbidden"));

    expect(failure.kind).toBe("permission");
    expect(failure.retryable).toBe(false);
    expect(failure.action).toEqual({ kind: "none" });
    expect(failure.message).toMatch(/owner or manager/i);
    expect(failure.message).not.toMatch(/discount/i);
    expect(isRetryBlocked(failure)).toBe(true);
  });

  it("maps an expired session to a sign-in recovery instead of a payment retry", () => {
    const failure = checkoutFailureFromError(apiError("UNAUTHENTICATED", 401, "Sign in required."));

    expect(failure.kind).toBe("session");
    expect(failure.retryable).toBe(false);
    expect(failure.action).toEqual({ kind: "sign_in", label: "Sign in again", href: "/login" });
    expect(isRetryBlocked(failure)).toBe(true);
  });

  it("maps SHIFT_NO_OPEN_SHIFT to the shifts recovery link", () => {
    const failure = checkoutFailureFromError(apiError("SHIFT_NO_OPEN_SHIFT", 409, "Shift required."));

    expect(failure.kind).toBe("shift");
    expect(failure.retryable).toBe(true);
    expect(failure.action).toEqual({ kind: "open_shift", label: "Open a shift", href: "/shifts" });
    expect(isRetryBlocked(failure)).toBe(false);
  });

  it("maps VALIDATION to review-and-retry copy and reuses human server messages", () => {
    const failure = checkoutFailureFromError(apiError("VALIDATION", 400, "Received amount must cover the total."));

    expect(failure.kind).toBe("validation");
    expect(failure.retryable).toBe(true);
    expect(failure.message).toBe("Received amount must cover the total.");
    expect(failure.action).toEqual({ kind: "retry", label: "Review and try again" });
  });

  it("falls back to an honest message when the server detail is code-like", () => {
    const failure = checkoutFailureFromError(apiError("VALIDATION", 400, "addr2_line1"));

    expect(failure.kind).toBe("validation");
    expect(failure.message).not.toContain("addr2_line1");
    expect(failure.message).toMatch(/rejected this sale/i);
  });

  it("maps an unexpected crash before any sale attempt to a blocked unknown outcome", () => {
    const failure = checkoutFailureFromError(new Error("boom"));

    expect(failure.kind).toBe("unknown_outcome");
    expect(failure.retryable).toBe(false);
    expect(failure.action).toEqual({ kind: "check_sale", label: "Check sale status", href: "/sales" });
    expect(failure.message).toMatch(/payment failed/i);
    expect(isRetryBlocked(failure)).toBe(true);
  });

  it("maps an unexpected crash with a sale context to that sale's status link", () => {
    const error = tagPosSaleAttempt(new Error("boom"), { phase: "checkout", saleId: "sale-crash" });
    const failure = checkoutFailureFromError(error);

    expect(failure.kind).toBe("unknown_outcome");
    expect(failure.saleId).toBe("sale-crash");
    expect(failure.action).toEqual({ kind: "check_sale", label: "Check sale status", href: "/sales/sale-crash" });
  });

  it("treats a conflict without a stock reason as an unknown outcome", () => {
    const error = tagPosSaleAttempt(
      apiError("SALE_ALREADY_COMPLETED", 409, "Sale already completed."),
      { phase: "complete", saleId: "sale-conflict" },
    );
    const failure = checkoutFailureFromError(error);

    expect(failure.kind).toBe("unknown_outcome");
    expect(failure.retryable).toBe(false);
    expect(failure.action.kind).toBe("check_sale");
  });

  it("never reports retry-blocked for a null or recoverable failure", () => {
    expect(isRetryBlocked(null)).toBe(false);
    expect(isRetryBlocked(undefined)).toBe(false);
  });

  it("preserves an unknown outcome when a new payment attempt starts", () => {
    const failure = checkoutFailureFromError(
      apiError("PAYMENT_PROVIDER_MISMATCH", 409, "The provider state is ambiguous."),
    );

    expect(failure.kind).toBe("unknown_outcome");
    expect(shouldClearCheckoutFailureForNewAttempt(failure)).toBe(false);
  });

  it("clears a recoverable failure when a new payment attempt starts", () => {
    const failure = checkoutFailureFromError(apiError("INSUFFICIENT_STOCK", 409, "Not enough stock."));

    expect(shouldClearCheckoutFailureForNewAttempt(failure)).toBe(true);
    expect(shouldClearCheckoutFailureForNewAttempt(null)).toBe(true);
  });
});

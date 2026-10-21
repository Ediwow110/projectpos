import { ApiError } from "./api";
import { errorText } from "./billing";
import type { PublicOrderStatus, PublicPaymentMethod } from "./orders";

/**
 * A payment still being confirmed is not a failed payment: offering a retry for
 * it would take money twice, so only a settled-nothing state is retryable.
 */
const RETRYABLE_PAYMENT_STATUSES = new Set(["FAILED", "UNPAID"]);

export function canRetryPayment(
  order: Pick<PublicOrderStatus, "status" | "paymentMode" | "paymentStatus">,
): boolean {
  return (
    order.status === "SUBMITTED"
    && order.paymentMode === "PREPAID"
    && RETRYABLE_PAYMENT_STATUSES.has(order.paymentStatus)
  );
}

export function retryRequestBody(method: PublicPaymentMethod | null): { paymentMethod: PublicPaymentMethod } | null {
  return method ? { paymentMethod: method } : null;
}

export interface RetryIntent {
  method: PublicPaymentMethod;
  key: string;
}

/**
 * Repeating the same intent must reuse the key so the server can answer with
 * the checkout it already opened; choosing a different method is a new intent
 * and must not replay the previous one.
 */
export function retryIntentFor(previous: RetryIntent | null, method: PublicPaymentMethod): RetryIntent {
  if (previous && previous.method === method) return previous;
  return { method, key: crypto.randomUUID() };
}

export function retryFailureCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "NOT_FOUND") {
    return "This retry only works in the browser that placed the order, within two hours of checkout.";
  }
  if (error instanceof ApiError && error.code === "RATE_LIMITED") {
    return "Too many payment attempts. Wait a minute, then try again.";
  }
  if (error instanceof ApiError && error.code === "INVALID_STATE") {
    return "The order moved on while this page was open. Refresh the status before paying again.";
  }
  return errorText(error, "The payment could not be restarted.");
}

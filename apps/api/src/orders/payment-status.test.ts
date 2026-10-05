import { describe, expect, it } from "vitest";
import { deriveOrderPaymentStatus } from "./payment-status";

function sale(status: string, totalMinor = 1000) {
  return { id: "s1", status, totalMinor } as any;
}
const payment = (status: string, amountMinor: number) => ({ id: status + amountMinor, status, amountMinor }) as any;
const refund = (totalMinor: number) => ({ id: "r" + totalMinor, status: "APPROVED", totalMinor }) as any;

describe("phase22 order payment projection", () => {
  it.each([
    [null, "UNPAID"],
    ["DRAFT", "UNPAID"],
    ["PENDING_PAYMENT", "PENDING"],
    ["PAYMENT_FAILED", "FAILED"],
    ["PAYMENT_UNKNOWN", "UNKNOWN"],
    ["PAID", "PAID"],
    ["COMPLETED", "PAID"],
    ["REFUND_REQUESTED", "PAID"],
    ["PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED"],
    ["REFUNDED", "REFUNDED"],
    ["VOIDED", "UNPAID"],
  ] as const)("maps Sale %s to %s nominally", (status, expected) => {
    expect(deriveOrderPaymentStatus({
      sale: status === null ? null : sale(status),
      payments: [],
      refunds: [],
      refundItems: [],
    })).toBe(expected);
  });

  it("uses financial evidence precedence over stale Sale status", () => {
    expect(deriveOrderPaymentStatus({
      sale: sale("COMPLETED"),
      payments: [payment("SUCCEEDED", 1000)],
      refunds: [refund(1000)],
      refundItems: [],
    })).toBe("REFUNDED");
    expect(deriveOrderPaymentStatus({
      sale: sale("COMPLETED"),
      payments: [payment("SUCCEEDED", 1000)],
      refunds: [refund(200)],
      refundItems: [],
    })).toBe("PARTIALLY_REFUNDED");
    expect(deriveOrderPaymentStatus({
      sale: sale("PENDING_PAYMENT"),
      payments: [payment("UNKNOWN", 1000)],
      refunds: [],
      refundItems: [],
    })).toBe("UNKNOWN");
    expect(deriveOrderPaymentStatus({
      sale: sale("PENDING_PAYMENT"),
      payments: [payment("SUCCEEDED", 1000)],
      refunds: [],
      refundItems: [],
    })).toBe("PAID");
  });

  it("resolves RECONCILED from payment rows", () => {
    expect(deriveOrderPaymentStatus({
      sale: sale("RECONCILED"),
      payments: [payment("FAILED", 1000)],
      refunds: [],
      refundItems: [],
    })).toBe("FAILED");
    expect(deriveOrderPaymentStatus({
      sale: sale("RECONCILED"),
      payments: [payment("PENDING", 1000)],
      refunds: [],
      refundItems: [],
    })).toBe("PENDING");
  });
});

import { describe, expect, it } from "vitest";
import { computeSaleTotals, requiresDiscountOverride } from "./totals";
import { transitionSale } from "./state-machine";
import { fingerprintPayload } from "./idempotency";

describe("phase4 sales domain", () => {
  it("computes subtotal, tax, and total in minor units", () => {
    const out = computeSaleTotals({
      lines: [
        { qty: 2, priceMinor: 2500, costMinor: 1000, taxRateBps: 1200, lineDiscountMinor: 0 },
        { qty: 1, priceMinor: 1000, costMinor: 400, taxRateBps: null, lineDiscountMinor: 100 },
      ],
      orderDiscountMinor: 0,
      businessTaxRateBps: null,
    });
    expect(out.subtotalMinor).toBe(5900);
    expect(out.taxMinor).toBe(600);
    expect(out.totalMinor).toBe(6500);
  });
  it("caps order discount at subtotal and never goes negative", () => {
    const out = computeSaleTotals({ lines: [], orderDiscountMinor: 99999, businessTaxRateBps: null });
    expect(out.totalMinor).toBe(0);
  });
  it("flags discounts above threshold for override", () => {
    expect(
      requiresDiscountOverride({ orderDiscountMinor: 200, subtotalMinor: 1000, lines: [] }),
    ).toBe(true);
    expect(
      requiresDiscountOverride({ orderDiscountMinor: 50, subtotalMinor: 1000, lines: [] }),
    ).toBe(false);
  });
  it("allows DRAFT->PENDING_PAYMENT->PAID->COMPLETED and rejects skips", () => {
    expect(transitionSale("DRAFT", "PENDING_PAYMENT")).toBe("PENDING_PAYMENT");
    expect(() => transitionSale("DRAFT", "COMPLETED")).toThrow("SALE_INVALID_TRANSITION");
    expect(() => transitionSale("COMPLETED", "DRAFT")).toThrow("SALE_INVALID_TRANSITION");
  });
  it("fingerprints deterministically regardless of key order", () => {
    expect(fingerprintPayload({ b: 1, a: 2 })).toBe(fingerprintPayload({ a: 2, b: 1 }));
  });
});

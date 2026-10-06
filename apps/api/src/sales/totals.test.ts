import { describe, expect, it } from "vitest";
import { computeSaleTotals, computeTaxMinor } from "./totals";

describe("phase22 shared tax rounding", () => {
  it("rounds delivery and merchandise tax with one convention", () => {
    expect(computeTaxMinor(333, 1200)).toBe(40);
    expect(computeTaxMinor(1000, null)).toBe(0);
    expect(computeTaxMinor(0, 1200)).toBe(0);
    expect(computeSaleTotals({
      lines: [{ qty: 1, priceMinor: 333, costMinor: 0, taxRateBps: 1200, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0,
      businessTaxRateBps: null,
    }).taxMinor).toBe(computeTaxMinor(333, 1200));
  });
});

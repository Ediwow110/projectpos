import { describe, expect, it } from "vitest";

import { exchangePreview } from "./exchange-view";

describe("exchange preview", () => {
  it("computes the net collect/refund from recorded return value and current replacement price", () => {
    expect(exchangePreview({
      lines: [{ id: "line-1", qty: 2, lineTotalMinor: 5000 }],
      products: [{ id: "p2", priceMinor: 3000, taxRateBps: null }],
      returnQty: { "line-1": 1 },
      replacementQty: { p2: 1 },
      businessTaxRateBps: null,
    })).toEqual({ returnMinor: 2500, replacementMinor: 3000, netMinor: 500, direction: "COLLECT" });
  });

  it("includes product or business tax in the replacement preview", () => {
    expect(exchangePreview({
      lines: [{ id: "line-1", qty: 1, lineTotalMinor: 2500 }],
      products: [{ id: "p2", priceMinor: 3000, taxRateBps: null }],
      returnQty: { "line-1": 1 },
      replacementQty: { p2: 1 },
      businessTaxRateBps: 1200,
    })).toEqual({ returnMinor: 2500, replacementMinor: 3360, netMinor: 860, direction: "COLLECT" });
  });
});

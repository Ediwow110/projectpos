import { describe, expect, it } from "vitest";
import { varianceSummary } from "./inventory-counts";

describe("inventory count presentation", () => {
  it("summarizes signed variances without losing positive and negative units", () => {
    expect(varianceSummary([
      { id: "a", productId: "a", expectedQtySnapshot: 10, balanceUpdatedAtSnapshot: null, countedQty: 8, varianceQty: -2, productNameSnapshot: "A", skuSnapshot: null, notes: null },
      { id: "b", productId: "b", expectedQtySnapshot: 5, balanceUpdatedAtSnapshot: null, countedQty: 7, varianceQty: 2, productNameSnapshot: "B", skuSnapshot: null, notes: null },
    ])).toEqual({ positive: 2, negative: -2, net: 0, products: 2 });
  });
});

import { describe, expect, it } from "vitest";

import { normalizeRefundRequests } from "./refund-normalization";

describe("refund request normalization", () => {
  it("groups duplicate sale lines and sorts by saleItemId for a stable fingerprint", () => {
    const items = [
      { saleItemId: "z", qty: 1 },
      { saleItemId: "a", qty: 2 },
      { saleItemId: "z", qty: 3 },
    ];
    const result = normalizeRefundRequests({ items });

    expect(result.items).toEqual([
      { saleItemId: "a", qty: 2 },
      { saleItemId: "z", qty: 4 },
    ]);
    expect(result.loadRefunds).toEqual([]);
    expect(items).toEqual([
      { saleItemId: "z", qty: 1 },
      { saleItemId: "a", qty: 2 },
      { saleItemId: "z", qty: 3 },
    ]);
  });

  it("coalesces repeated gift-card loads and sorts by loadId", () => {
    expect(normalizeRefundRequests({
      items: [],
      loadRefunds: [
        { loadId: "z-load", amountMinor: 125 },
        { loadId: "a-load", amountMinor: 50 },
        { loadId: "z-load", amountMinor: 75 },
      ],
    }).loadRefunds).toEqual([
      { loadId: "a-load", amountMinor: 50 },
      { loadId: "z-load", amountMinor: 200 },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the original invalid gift-card amount %s before processing",
    (amountMinor) => {
      expect(() => normalizeRefundRequests({
        items: [{ saleItemId: "line", qty: 1 }],
        loadRefunds: [{ loadId: "load", amountMinor }],
      })).toThrow("VALIDATION");
    },
  );
});

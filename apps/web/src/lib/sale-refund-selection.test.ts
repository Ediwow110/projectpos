import { describe, expect, it } from "vitest";
import { selectSaleRefund } from "./sale-refund-selection";

const sale = {
  items: [
    { id: "a", qty: 3, lineTotalMinor: 1000 },
    { id: "b", qty: 2, lineTotalMinor: 800 },
  ],
  giftCardLoads: [{ id: "load-a" }, { id: "load-b" }],
};

describe("sale refund selection", () => {
  it("preserves selected line ordering and line-total rounding", () => {
    const selection = selectSaleRefund(sale, { a: "2", b: "0" }, {}, 900);
    expect(selection.items).toEqual([{ saleItemId: "a", qty: 2 }]);
    expect(selection.loadRefunds).toEqual([]);
    expect(selection.refundTotalMinor).toBe(667);
    expect(selection.selectedRefundTotalMinor).toBe(667);
    expect(selection.permission).toBe("sale.refund");
  });

  it("includes valid load amounts, ignores invalid ones and uses strict threshold", () => {
    const selection = selectSaleRefund(sale, { b: "1" }, { "load-a": "1.25", "load-b": "invalid" }, 525);
    expect(selection.items).toEqual([{ saleItemId: "b", qty: 1 }]);
    expect(selection.loadRefunds).toEqual([{ loadId: "load-a", amountMinor: 125 }]);
    expect(selection.refundLoadTotalMinor).toBe(125);
    expect(selection.selectedRefundTotalMinor).toBe(525);
    expect(selection.permission).toBe("sale.refund");
    expect(selectSaleRefund(sale, { b: "1" }, { "load-a": "1.25" }, 524).permission).toBe("refund.override");
  });

  it("keeps no-sale selection empty and respects nonnumeric approval threshold", () => {
    expect(selectSaleRefund(undefined, { a: "1" }, {}, undefined)).toMatchObject({
      items: [], loadRefunds: [], selectedRefundTotalMinor: 0, permission: "sale.refund",
    });
  });
});

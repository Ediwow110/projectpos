import { describe, expect, it } from "vitest";

describe("phase4 pos web helpers", () => {
  it("sums a local cart in minor units", async () => {
    const { cartTotal } = await import("../src/lib/sales");
    expect(cartTotal([{ qty: 2, priceMinor: 2500, lineDiscountMinor: 0 }])).toBe(5000);
  });
  it("gates void and refund affordances by permission", async () => {
    const { canVoidSale, canRequestRefund } = await import("../src/lib/sales");
    expect(canVoidSale(["sale.void"])).toBe(true);
    expect(canVoidSale([])).toBe(false);
    expect(canRequestRefund(["sale.refund"])).toBe(true);
    expect(canRequestRefund([])).toBe(false);
  });
  it("builds the complete-sale payload with idempotency key", async () => {
    const { buildCompletePayload } = await import("../src/lib/sales");
    const out = buildCompletePayload("s1", [{ method: "cash", amountMinor: 100 }], "key-1");
    expect(out).toEqual({
      saleId: "s1",
      payments: [{ method: "cash", amountMinor: 100 }],
      idempotencyKey: "key-1",
    });
  });
});

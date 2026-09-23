import { describe, expect, it } from "vitest";
import { refundApproveSchema, refundRejectSchema } from "../src/refunds.schema";

describe("phase6 refund schemas", () => {
  it("rejects empty items", () => {
    expect(() => refundApproveSchema.parse({ saleId: "s1", items: [] })).toThrow();
  });
  it("rejects zero qty", () => {
    expect(() =>
      refundApproveSchema.parse({ saleId: "s1", items: [{ saleItemId: "i1", qty: 0 }] }),
    ).toThrow();
  });
  it("rejects short reject reason", () => {
    expect(() => refundRejectSchema.parse({ reason: "no" })).toThrow();
  });
  it("accepts a valid approval", () => {
    const out = refundApproveSchema.parse({ saleId: "s1", items: [{ saleItemId: "i1", qty: 1 }] });
    expect(out.items.length).toBe(1);
  });
});

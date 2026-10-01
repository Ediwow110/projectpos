import { describe, expect, it } from "vitest";
import { exchangeCreateSchema, refundApproveSchema, refundRejectSchema } from "../src/refunds.schema";

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

  it("accepts only a sufficiently opaque approval token", () => {
    expect(refundApproveSchema.parse({
      saleId: "s1",
      items: [{ saleItemId: "i1", qty: 1 }],
      approvalToken: "mgr_12345678901234567890",
    }).approvalToken).toBe("mgr_12345678901234567890");
    expect(() => refundApproveSchema.parse({
      saleId: "s1",
      items: [{ saleItemId: "i1", qty: 1 }],
      approvalToken: "short",
    })).toThrow();
  });

  it("accepts a cash-register exchange with returns and replacements", () => {
    const out = exchangeCreateSchema.parse({
      saleId: "s1",
      returns: [{ saleItemId: "i1", qty: 1 }],
      replacements: [{ productId: "p2", qty: 2 }],
      reason: "Wrong size",
    });
    expect(out.returns).toEqual([{ saleItemId: "i1", qty: 1 }]);
    expect(out.replacements).toEqual([{ productId: "p2", qty: 2 }]);
  });

  it("rejects exchanges without either side or a meaningful reason", () => {
    expect(() => exchangeCreateSchema.parse({ saleId: "s1", returns: [], replacements: [{ productId: "p2", qty: 1 }], reason: "Wrong size" })).toThrow();
    expect(() => exchangeCreateSchema.parse({ saleId: "s1", returns: [{ saleItemId: "i1", qty: 1 }], replacements: [], reason: "Wrong size" })).toThrow();
    expect(() => exchangeCreateSchema.parse({ saleId: "s1", returns: [{ saleItemId: "i1", qty: 1 }], replacements: [{ productId: "p2", qty: 1 }], reason: "x" })).toThrow();
  });
});

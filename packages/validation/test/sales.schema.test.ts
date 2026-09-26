import { describe, expect, it } from "vitest";
import { draftCreateSchema, completeSchema, reconcileSchema } from "../src/sales.schema";

describe("phase4 sales schemas", () => {
  it("rejects empty cart lines", () => {
    expect(() => draftCreateSchema.parse({ lines: [] })).toThrow();
  });
  it("rejects zero quantity", () => {
    expect(() =>
      draftCreateSchema.parse({ lines: [{ productId: "p1", qty: 0 }] }),
    ).toThrow();
  });
  it("rejects unknown payment method", () => {
    expect(() =>
      completeSchema.parse({
        saleId: "s1",
        payments: [{ method: "bitcoin", amountMinor: 100 }],
        idempotencyKey: "key-12345",
      }),
    ).toThrow();
  });
  it("rejects unknown reconcile outcome", () => {
    expect(() => reconcileSchema.parse({ outcome: "MAYBE" })).toThrow();
  });
  it("accepts a minimal valid draft", () => {
    const out = draftCreateSchema.parse({ lines: [{ productId: "p1", qty: 2 }] });
    expect(out.lines[0].qty).toBe(2);
  });
  it("accepts QR Ph as a payment method", () => {
    const out = completeSchema.parse({
      saleId: "s1",
      payments: [{ method: "qrph", amountMinor: 100 }],
      idempotencyKey: "key-qrph-1",
    });
    expect(out.payments[0]?.method).toBe("qrph");
  });
});

describe("phase5 registerId on sales schemas", () => {
  it("accepts drafts with and without registerId", async () => {
    const { draftCreateSchema, completeSchema } = await import("../src/sales.schema");
    expect(draftCreateSchema.parse({ lines: [{ productId: "p1", qty: 1 }], registerId: "r1" }).registerId).toBe("r1");
    expect(
      completeSchema.parse({ saleId: "s1", payments: [{ method: "cash", amountMinor: 100 }], idempotencyKey: "key-12345", registerId: "r1" }).registerId,
    ).toBe("r1");
  });
});

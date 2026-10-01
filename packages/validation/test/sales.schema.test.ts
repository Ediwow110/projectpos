import { describe, expect, it } from "vitest";
import { draftCreateSchema, completeSchema, discountApprovalSchema, receiptEmailSchema, reconcileSchema, voidSaleSchema } from "../src/sales.schema";

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
  it("accepts a one-use manager approval token on a draft", () => {
    const out = draftCreateSchema.parse({
      lines: [{ productId: "p1", qty: 1, lineDiscountMinor: 300 }],
      orderDiscountMinor: 200,
      approvalToken: "mgr_12345678901234567890",
    });
    expect(out.approvalToken).toBe("mgr_12345678901234567890");
  });
  it("validates manager approval credentials plus the exact discounted cart", () => {
    const out = discountApprovalSchema.parse({
      email: "manager@example.com",
      password: "correct-horse-12",
      lines: [{ productId: "p1", qty: 1, lineDiscountMinor: 300 }],
      orderDiscountMinor: 200,
    });
    expect(out.email).toBe("manager@example.com");
    expect(out.lines[0]?.lineDiscountMinor).toBe(300);
    const byPin = discountApprovalSchema.parse({
      email: "manager@example.com",
      pin: "482615",
      lines: [{ productId: "p1", qty: 1, lineDiscountMinor: 300 }],
      orderDiscountMinor: 200,
    });
    expect(byPin.pin).toBe("482615");
    expect(() => discountApprovalSchema.parse({
      email: "manager@example.com",
      password: "correct-horse-12",
      pin: "482615",
      lines: [{ productId: "p1", qty: 1 }],
    })).toThrow();
    expect(() => discountApprovalSchema.parse({
      email: "manager@example.com",
      lines: [{ productId: "p1", qty: 1 }],
    })).toThrow();
  });
  it("accepts QR Ph as a payment method", () => {
    const out = completeSchema.parse({
      saleId: "s1",
      payments: [{ method: "qrph", amountMinor: 100 }],
      idempotencyKey: "key-qrph-1",
    });
    expect(out.payments[0]?.method).toBe("qrph");
  });
  it("validates a receipt email recipient without accepting arbitrary delivery payloads", () => {
    expect(receiptEmailSchema.parse({ to: " Customer@example.com " })).toEqual({ to: "Customer@example.com" });
    expect(() => receiptEmailSchema.parse({ to: "not-an-email" })).toThrow();
    expect(() => receiptEmailSchema.parse({ to: "customer@example.com", channel: "sms" })).toThrow();
  });
  it("requires a meaningful reason and opaque token for protected voids", () => {
    expect(voidSaleSchema.parse({ reason: "Duplicate order", approvalToken: "mgr_12345678901234567890" })).toEqual({
      reason: "Duplicate order", approvalToken: "mgr_12345678901234567890",
    });
    expect(() => voidSaleSchema.parse({ reason: "no" })).toThrow();
    expect(() => voidSaleSchema.parse({ reason: "Duplicate order", approvalToken: "short" })).toThrow();
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

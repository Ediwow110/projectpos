import { describe, expect, it } from "vitest";
import {
  correctionSchema,
  emailVerificationSchema,
  paymentMethodConfigSchema,
  refundThresholdSchema,
  supportGrantSchema,
} from "../src/phase11.schema";

describe("phase11 schemas", () => {
  it("accepts a configured payment method list", () => {
    const out = paymentMethodConfigSchema.parse([
      { key: "cash", label: "Cash" },
      { key: "gcash", label: "GCash" },
    ]);
    expect(out).toHaveLength(2);
  });
  it("rejects empty method keys and oversized lists", () => {
    expect(() => paymentMethodConfigSchema.parse([{ key: "", label: "x" }])).toThrow();
    expect(() => paymentMethodConfigSchema.parse([])).toThrow();
  });
  it("validates refund threshold and email flag", () => {
    expect(refundThresholdSchema.parse({ thresholdMinor: 5000 }).thresholdMinor).toBe(5000);
    expect(() => refundThresholdSchema.parse({ thresholdMinor: -1 })).toThrow();
    expect(emailVerificationSchema.parse({ requireEmailVerification: true }).requireEmailVerification).toBe(true);
  });
  it("requires a reason and nonzero correction, bounds grant ttl", () => {
    expect(() => correctionSchema.parse({ amountMinor: 0, reason: "why" })).toThrow();
    expect(() => correctionSchema.parse({ amountMinor: 100, reason: "no" })).toThrow();
    expect(correctionSchema.parse({ amountMinor: -500, reason: "counted wrong" }).amountMinor).toBe(-500);
    expect(supportGrantSchema.parse({ purpose: "invoice support", ttlMinutes: 30, actorId: "ops" }).ttlMinutes).toBe(30);
    expect(() => supportGrantSchema.parse({ purpose: "x", ttlMinutes: 61, actorId: "ops" })).toThrow();
  });
});

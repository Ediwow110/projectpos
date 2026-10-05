import { describe, expect, it } from "vitest";
import { deliveryRefundRemaining, voidAuditLabel } from "./sales";

describe("sale void presentation", () => {
  it("shows the retained reason and timestamp only for voided sales", () => {
    expect(voidAuditLabel({
      status: "VOIDED",
      voidReason: "Duplicate draft",
      voidedAt: "2026-10-06T10:00:00.000Z",
    })).toContain("Duplicate draft");
    expect(voidAuditLabel({ status: "COMPLETED", voidReason: null, voidedAt: null })).toBeNull();
  });
});

describe("delivery refund presentation", () => {
  it("returns the full remaining delivery charge and never a partial amount", () => {
    expect(deliveryRefundRemaining({
      deliveryFeeMinor: 1000,
      deliveryTaxMinor: 120,
      refunds: [{ deliveryFeeRefundMinor: 0, deliveryTaxRefundMinor: 0 }],
    })).toBe(1120);
    expect(deliveryRefundRemaining({
      deliveryFeeMinor: 1000,
      deliveryTaxMinor: 120,
      refunds: [{ deliveryFeeRefundMinor: 1000, deliveryTaxRefundMinor: 120 }],
    })).toBe(0);
  });
});

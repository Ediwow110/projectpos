import { describe, expect, it } from "vitest";
import { assertPurchaseOrderTransition, computePurchaseOrderTotals } from "./purchase-order-math";

describe("purchase-order state machine", () => {
  it("allows only Phase 16 transitions", () => {
    expect(() => assertPurchaseOrderTransition("DRAFT", "ORDERED")).not.toThrow();
    expect(() => assertPurchaseOrderTransition("DRAFT", "CANCELLED")).not.toThrow();
    expect(() => assertPurchaseOrderTransition("ORDERED", "CANCELLED")).not.toThrow();
    expect(() => assertPurchaseOrderTransition("ORDERED", "ORDERED")).toThrow("PURCHASE_ORDER_INVALID_STATE");
    expect(() => assertPurchaseOrderTransition("CANCELLED", "ORDERED")).toThrow("PURCHASE_ORDER_INVALID_STATE");
  });

  it("computes server-side totals and rejects unsafe values", () => {
    expect(computePurchaseOrderTotals([{ quantity: 2, unitCostMinor: 125 }, { quantity: 3, unitCostMinor: 300 }])).toEqual({ subtotalMinor: 1150, taxMinor: 0, totalMinor: 1150 });
    expect(() => computePurchaseOrderTotals([{ quantity: 0, unitCostMinor: 1 }])).toThrow("VALIDATION");
    expect(() => computePurchaseOrderTotals([{ quantity: 1, unitCostMinor: -1 }])).toThrow("VALIDATION");
  });
});

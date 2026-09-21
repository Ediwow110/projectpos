import { describe, expect, it } from "vitest";
import { signFor, validateQtyDelta } from "./signs";
import { applyMovementToBalance, computeBalanceFromLedger, deriveStockStatus } from "./projection";

describe("phase3 inventory domain", () => {
  it("signs receive positive and damage negative, adjustment either", () => {
    expect(signFor("receive")).toBe(1);
    expect(signFor("damage")).toBe(-1);
    expect(signFor("adjustment")).toBe(0);
  });
  it("rejects zero and mismatched signs", () => {
    expect(() => validateQtyDelta("receive", 0)).toThrow("VALIDATION");
    expect(() => validateQtyDelta("receive", -5)).toThrow("VALIDATION");
    expect(() => validateQtyDelta("damage", 5)).toThrow("VALIDATION");
    validateQtyDelta("adjustment", -5);
  });
  it("applies a movement to a balance", () => {
    expect(applyMovementToBalance(10, { qtyDelta: -3 })).toBe(7);
  });
  it("sums a ledger", () => {
    expect(computeBalanceFromLedger([{ qtyDelta: 100 }, { qtyDelta: -2 }, { qtyDelta: -1 }])).toBe(97);
  });
  it("derives low and out status from balance and reorder level", () => {
    expect(deriveStockStatus({ qtyOnHand: 0, reorderLevel: 5, trackInventory: true })).toBe("out");
    expect(deriveStockStatus({ qtyOnHand: 3, reorderLevel: 5, trackInventory: true })).toBe("low");
    expect(deriveStockStatus({ qtyOnHand: 9, reorderLevel: 5, trackInventory: true })).toBe("ok");
    expect(deriveStockStatus({ qtyOnHand: 0, reorderLevel: 5, trackInventory: false })).toBe("untracked");
  });
});

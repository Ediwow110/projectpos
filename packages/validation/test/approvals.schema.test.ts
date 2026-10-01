import { describe, expect, it } from "vitest";
import { managerApprovalRequestSchema } from "../src/approvals.schema";

describe("manager approval schemas", () => {
  const voidAction = { kind: "sale_void" as const, saleId: "sale-1", reason: "Duplicate order" };

  it("accepts exactly one credential for a permitted action", () => {
    expect(managerApprovalRequestSchema.parse({
      email: "manager@example.com",
      pin: "482615",
      permission: "sale.void",
      action: voidAction,
    }).permission).toBe("sale.void");
  });

  it("rejects missing or conflicting credentials", () => {
    expect(() => managerApprovalRequestSchema.parse({
      email: "manager@example.com", permission: "sale.void", action: voidAction,
    })).toThrow();
    expect(() => managerApprovalRequestSchema.parse({
      email: "manager@example.com", pin: "482615", password: "secret", permission: "sale.void", action: voidAction,
    })).toThrow();
  });

  it("rejects permission and action pairings outside the allow-list", () => {
    expect(() => managerApprovalRequestSchema.parse({
      email: "manager@example.com", pin: "482615", permission: "inventory.adjust", action: voidAction,
    })).toThrow();
  });

  it("accepts each protected action shape", () => {
    const base = { email: "manager@example.com", password: "secret" };
    expect(managerApprovalRequestSchema.parse({
      ...base, permission: "discount.override", action: { kind: "discount", lines: [{ productId: "p1", qty: 1, lineDiscountMinor: 10 }], orderDiscountMinor: 0 },
    }).action.kind).toBe("discount");
    expect(managerApprovalRequestSchema.parse({
      ...base, permission: "sale.refund", action: { kind: "refund", saleId: "sale-1", items: [{ saleItemId: "item-1", qty: 1 }] },
    }).action.kind).toBe("refund");
    expect(managerApprovalRequestSchema.parse({
      ...base, permission: "inventory.adjust", action: { kind: "inventory_movement", productId: "p1", movementType: "adjustment", qtyDelta: -1, branchId: "branch-1" },
    }).action.kind).toBe("inventory_movement");
    expect(managerApprovalRequestSchema.parse({
      ...base, permission: "shift.close.override", action: { kind: "shift_close", shiftId: "shift-1", countedCashMinor: 100 },
    }).action.kind).toBe("shift_close");
  });
});

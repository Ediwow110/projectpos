import { describe, expect, it } from "vitest";

describe("phase6 customer web helpers", () => {
  it("gates customer management by role", async () => {
    const { canManageCustomers } = await import("../src/lib/customers");
    expect(canManageCustomers("manager")).toBe(true);
    expect(canManageCustomers("cashier")).toBe(false);
  });
  it("formats a customer label", async () => {
    const { customerLabel } = await import("../src/lib/customers");
    expect(customerLabel({ name: "Ana", phone: "0917" })).toBe("Ana — 0917");
    expect(customerLabel({ name: "Walk-in", phone: null })).toBe("Walk-in");
  });
  it("gates expense voids by role", async () => {
    const { canVoidExpense } = await import("../src/lib/expenses");
    expect(canVoidExpense("owner")).toBe(true);
    expect(canVoidExpense("cashier")).toBe(false);
  });
});

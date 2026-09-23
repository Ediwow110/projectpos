import { describe, expect, it } from "vitest";
import { signForCash, validateCashAmount, computeExpectedCash, computeVariance } from "./cash";

describe("phase5 cash domain", () => {
  it("signs inflows positive and outflows negative, adjustment either", () => {
    expect(signForCash("cash_sale")).toBe(1);
    expect(signForCash("paid_out")).toBe(-1);
    expect(signForCash("cash_deposit")).toBe(1);
    expect(signForCash("cash_withdrawal")).toBe(-1);
    expect(signForCash("adjustment")).toBe(0);
  });
  it("rejects zero and mismatched signs", () => {
    expect(() => validateCashAmount("cash_sale", 0)).toThrow("VALIDATION");
    expect(() => validateCashAmount("cash_sale", -5)).toThrow("VALIDATION");
    expect(() => validateCashAmount("paid_out", 5)).toThrow("VALIDATION");
    validateCashAmount("adjustment", -5);
  });
  it("computes expected cash from components", () => {
    expect(
      computeExpectedCash({
        openingFloat: 10000, cashSales: 5000, cashRefunds: 0,
        cashExpenses: 1200, cashDeposits: 2000, cashWithdrawals: 500, adjustments: -300,
      }),
    ).toBe(15000);
  });
  it("computes signed variance", () => {
    expect(computeVariance(15200, 15000)).toBe(200);
    expect(computeVariance(14900, 15000)).toBe(-100);
  });
  it("sums a movement ledger into components", async () => {
    const { sumCashComponents } = await import("./cash");
    const out = sumCashComponents([
      { type: "cash_sale", amountMinor: 5000 },
      { type: "paid_out", amountMinor: -1200 },
      { type: "cash_deposit", amountMinor: 2000 },
    ]);
    expect(out).toEqual({ cashSales: 5000, cashRefunds: 0, cashExpenses: 1200, cashDeposits: 2000, cashWithdrawals: 0, adjustments: 0 });
  });
});

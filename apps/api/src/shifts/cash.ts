export type CashMovementType =
  | "opening_float" | "cash_sale" | "cash_refund" | "paid_out"
  | "cash_deposit" | "cash_withdrawal" | "adjustment";

export type CashKind = "paid_out" | "cash_deposit" | "cash_withdrawal" | "adjustment";

const POSITIVE = new Set(["opening_float", "cash_sale", "cash_deposit"]);
const NEGATIVE = new Set(["cash_refund", "paid_out", "cash_withdrawal"]);

export function signForCash(type: CashMovementType): 1 | -1 | 0 {
  if (POSITIVE.has(type)) return 1;
  if (NEGATIVE.has(type)) return -1;
  return 0;
}

export function validateCashAmount(type: CashMovementType, amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor === 0) throw new Error("VALIDATION");
  const sign = signForCash(type);
  if (sign === 1 && amountMinor < 0) throw new Error("VALIDATION");
  if (sign === -1 && amountMinor > 0) throw new Error("VALIDATION");
}

export interface CashComponents {
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  cashExpenses: number;
  cashDeposits: number;
  cashWithdrawals: number;
  adjustments: number;
}

export function computeExpectedCash(c: CashComponents): number {
  return (
    c.openingFloat + c.cashSales - c.cashRefunds - c.cashExpenses
    + c.cashDeposits - c.cashWithdrawals + c.adjustments
  );
}

export function computeVariance(countedCashMinor: number, expectedCashMinor: number): number {
  return countedCashMinor - expectedCashMinor;
}

export function sumCashComponents(
  movements: Array<{ type: string; amountMinor: number }>,
): Omit<CashComponents, "openingFloat"> {
  const out = { cashSales: 0, cashRefunds: 0, cashExpenses: 0, cashDeposits: 0, cashWithdrawals: 0, adjustments: 0 };
  for (const m of movements) {
    if (m.type === "cash_sale") out.cashSales += m.amountMinor;
    else if (m.type === "cash_refund") out.cashRefunds += -m.amountMinor;
    else if (m.type === "paid_out") out.cashExpenses += -m.amountMinor;
    else if (m.type === "cash_deposit") out.cashDeposits += m.amountMinor;
    else if (m.type === "cash_withdrawal") out.cashWithdrawals += -m.amountMinor;
    else if (m.type === "adjustment") out.adjustments += m.amountMinor;
  }
  return out;
}

import type { AccountingAccountDefinition } from "./accounting-types";

// Codes 1000–7000 retain the established Phase 10 CSV meanings. New liability
// codes are kept in the 2xxx range; purchase price variance is an expense.
export const DEFAULT_ACCOUNTS: readonly AccountingAccountDefinition[] = [
  { code: "1000", name: "Cash on Hand", type: "asset", normalSide: "debit", system: true },
  { code: "1400", name: "Inventory", type: "asset", normalSide: "debit", system: true },
  { code: "2100", name: "Card and Bank Clearing", type: "asset", normalSide: "debit", system: true },
  { code: "2110", name: "E-Wallet Clearing", type: "asset", normalSide: "debit", system: true },
  { code: "2120", name: "Other Clearing", type: "asset", normalSide: "debit", system: true },
  { code: "2000", name: "Accounts Payable", type: "liability", normalSide: "credit", system: true },
  { code: "2200", name: "Change Payable", type: "liability", normalSide: "credit", system: true },
  { code: "2210", name: "Delivery Tax Payable", type: "liability", normalSide: "credit", system: true },
  { code: "2220", name: "Goods Received Not Invoiced", type: "liability", normalSide: "credit", system: true },
  { code: "2300", name: "Gift Card Liability", type: "liability", normalSide: "credit", system: true },
  { code: "2310", name: "Store Credit Liability", type: "liability", normalSide: "credit", system: true },
  { code: "2320", name: "Loyalty Liability", type: "liability", normalSide: "credit", system: true },
  { code: "3000", name: "Retained Earnings", type: "equity", normalSide: "credit", system: true },
  { code: "4000", name: "Merchandise Revenue", type: "revenue", normalSide: "credit", system: true },
  { code: "4010", name: "Delivery Revenue", type: "revenue", normalSide: "credit", system: true },
  { code: "4020", name: "Sales Discounts", type: "expense", normalSide: "debit", system: true },
  { code: "5000", name: "Cost of Goods Sold", type: "expense", normalSide: "debit", system: true },
  { code: "5100", name: "Purchase Price Variance", type: "expense", normalSide: "debit", system: true },
  { code: "6000", name: "Operating Expenses", type: "expense", normalSide: "debit", system: true },
  { code: "7000", name: "Inventory Receipts (Legacy Export)", type: "expense", normalSide: "debit", system: true },
] as const;

export const ACCOUNT_BY_CODE: Readonly<Record<string, AccountingAccountDefinition>> = Object.fromEntries(
  DEFAULT_ACCOUNTS.map((account) => [account.code, account]),
);

const PAYMENT_ACCOUNT_BY_METHOD: Readonly<Record<string, string>> = {
  cash: "1000",
  card: "2100",
  bank_transfer: "2100",
  gcash: "2110",
  maya: "2110",
  qrph: "2110",
  other: "2120",
  gift_card: "2300",
  store_credit: "2310",
  loyalty: "2320",
};

export function accountForMethod(method: string): string {
  return PAYMENT_ACCOUNT_BY_METHOD[method] ?? "2120";
}

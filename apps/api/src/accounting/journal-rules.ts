import type { JournalDraft, JournalLineDraft, JournalTotals, PostingTender, SourceEventIdentity } from "./accounting-types";
import { ACCOUNT_BY_CODE, DEFAULT_ACCOUNTS, accountForMethod } from "./chart-of-accounts";

export { ACCOUNT_BY_CODE, DEFAULT_ACCOUNTS, accountForMethod };

type DraftInput = Partial<Pick<JournalDraft, "effectiveAt" | "description">> & {
  currency: string;
  lines: JournalLineDraft[];
};

function invalid(code: string): never {
  throw new Error(code);
}

function safeMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateJournalDraft(draft: JournalDraft): JournalTotals {
  if (!draft.effectiveAt || Number.isNaN(draft.effectiveAt.getTime())) invalid("ACCOUNTING_INVALID_DATE");
  if (!/^[A-Z]{3}$/.test(draft.currency)) invalid("ACCOUNTING_INVALID_CURRENCY");
  let debitMinor = 0;
  let creditMinor = 0;
  for (const line of draft.lines) {
    if (!ACCOUNT_BY_CODE[line.accountCode]) invalid("ACCOUNTING_INVALID_ACCOUNT");
    if (!safeMinor(line.debitMinor) || !safeMinor(line.creditMinor) || (line.debitMinor === 0) === (line.creditMinor === 0)) {
      invalid("ACCOUNTING_INVALID_AMOUNT");
    }
    debitMinor += line.debitMinor;
    creditMinor += line.creditMinor;
    if (!Number.isSafeInteger(debitMinor) || !Number.isSafeInteger(creditMinor)) invalid("ACCOUNTING_INVALID_AMOUNT");
  }
  if (draft.lines.length < 2) invalid("ACCOUNTING_INVALID_ENTRY");
  if (debitMinor !== creditMinor) invalid("ACCOUNTING_UNBALANCED_ENTRY");
  return { debitMinor, creditMinor };
}

export function buildBalancedDraft(input: DraftInput): JournalDraft {
  if (!input.effectiveAt || Number.isNaN(input.effectiveAt.getTime())) invalid("ACCOUNTING_INVALID_DATE");
  if (!/^[A-Z]{3}$/.test(input.currency)) invalid("ACCOUNTING_INVALID_CURRENCY");
  const draft: JournalDraft = {
    effectiveAt: input.effectiveAt,
    currency: input.currency,
    description: input.description ?? "",
    lines: input.lines.filter((line) => line.debitMinor !== 0 || line.creditMinor !== 0),
  };
  validateJournalDraft(draft);
  return draft;
}

export function createSourceEventKey(identity: SourceEventIdentity): string {
  if (![identity.businessId, identity.sourceType, identity.sourceId, identity.sourceEvent].every((part) => part.trim().length > 0)) {
    invalid("ACCOUNTING_INVALID_SOURCE");
  }
  return [identity.businessId, identity.sourceType, identity.sourceId, identity.sourceEvent].join(":");
}

function debit(accountCode: string, amountMinor: number, memo?: string): JournalLineDraft {
  return { accountCode, debitMinor: amountMinor, creditMinor: 0, ...(memo ? { memo } : {}) };
}

function credit(accountCode: string, amountMinor: number, memo?: string): JournalLineDraft {
  return { accountCode, debitMinor: 0, creditMinor: amountMinor, ...(memo ? { memo } : {}) };
}

function requireAmount(value: number): void {
  if (!safeMinor(value)) invalid("ACCOUNTING_INVALID_AMOUNT");
}

export function buildSaleDraft(input: {
  currency: string;
  effectiveAt: Date;
  tenders: PostingTender[];
  merchandiseRevenueMinor: number;
  deliveryFeeMinor?: number;
  taxPayableMinor?: number;
  giftCardLoadMinor?: number;
  storeCreditIssuedMinor?: number;
  loyaltyIssuedMinor?: number;
  changeMinor?: number;
  cogsMinor?: number;
}): JournalDraft {
  const lines: JournalLineDraft[] = [];
  for (const tender of input.tenders) {
    requireAmount(tender.amountMinor);
    if (tender.amountMinor > 0) lines.push(debit(accountForMethod(tender.method), tender.amountMinor));
  }
  const credits: Array<[string, number]> = [
    ["4000", input.merchandiseRevenueMinor], ["4010", input.deliveryFeeMinor ?? 0],
    ["2210", input.taxPayableMinor ?? 0], ["2300", input.giftCardLoadMinor ?? 0],
    ["2310", input.storeCreditIssuedMinor ?? 0], ["2320", input.loyaltyIssuedMinor ?? 0],
    ["2200", input.changeMinor ?? 0],
  ];
  for (const [accountCode, amount] of credits) {
    requireAmount(amount);
    if (amount > 0) lines.push(credit(accountCode, amount));
  }
  const cogsMinor = input.cogsMinor ?? 0;
  requireAmount(cogsMinor);
  if (cogsMinor > 0) lines.push(debit("5000", cogsMinor, "Cost of goods sold"), credit("1400", cogsMinor, "Inventory relieved"));
  return buildBalancedDraft({ ...input, description: "Completed sale", lines });
}

export function buildRefundDraft(input: {
  currency: string;
  effectiveAt: Date;
  tenders: PostingTender[];
  merchandiseRevenueMinor: number;
  deliveryRevenueMinor?: number;
  taxPayableMinor?: number;
  giftCardLiabilityMinor?: number;
  storeCreditLiabilityMinor?: number;
  loyaltyLiabilityMinor?: number;
  restockedCostMinor?: number;
}): JournalDraft {
  const lines: JournalLineDraft[] = [];
  for (const [accountCode, amount] of [
    ["4000", input.merchandiseRevenueMinor], ["4010", input.deliveryRevenueMinor ?? 0],
    ["2210", input.taxPayableMinor ?? 0], ["2300", input.giftCardLiabilityMinor ?? 0],
    ["2310", input.storeCreditLiabilityMinor ?? 0], ["2320", input.loyaltyLiabilityMinor ?? 0],
  ] as Array<[string, number]>) {
    requireAmount(amount);
    if (amount > 0) lines.push(debit(accountCode, amount));
  }
  for (const tender of input.tenders) {
    requireAmount(tender.amountMinor);
    if (tender.amountMinor > 0) lines.push(credit(accountForMethod(tender.method), tender.amountMinor));
  }
  const restockedCostMinor = input.restockedCostMinor ?? 0;
  requireAmount(restockedCostMinor);
  if (restockedCostMinor > 0) lines.push(debit("1400", restockedCostMinor, "Restocked inventory"), credit("5000", restockedCostMinor, "Reverse cost of goods sold"));
  return buildBalancedDraft({ ...input, description: "Approved refund", lines });
}

export function buildExpenseDraft(input: { currency: string; amountMinor: number; expenseAccountCode: string; paidFromAccountCode: string; effectiveAt?: Date }): JournalDraft {
  requireAmount(input.amountMinor);
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt ?? new Date(), description: "Expense", lines: [debit(input.expenseAccountCode, input.amountMinor), credit(input.paidFromAccountCode, input.amountMinor)] });
}

export function buildPurchaseReceiptDraft(input: { currency: string; inventoryCostMinor: number; effectiveAt?: Date }): JournalDraft {
  requireAmount(input.inventoryCostMinor);
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt ?? new Date(), description: "Posted purchase receipt", lines: [debit("1400", input.inventoryCostMinor), credit("2220", input.inventoryCostMinor)] });
}

export function buildSupplierBillDraft(input: { currency: string; receiptCostMinor: number; invoiceAmountMinor: number; nonStockChargeMinor?: number; expenseAccountCode?: string; effectiveAt?: Date }): JournalDraft {
  requireAmount(input.receiptCostMinor);
  requireAmount(input.invoiceAmountMinor);
  const charge = input.nonStockChargeMinor ?? 0;
  requireAmount(charge);
  const variance = input.invoiceAmountMinor - input.receiptCostMinor;
  const lines: JournalLineDraft[] = [];
  if (input.receiptCostMinor > 0) lines.push(debit("2220", input.receiptCostMinor));
  if (variance > 0) lines.push(debit("5100", variance, "Invoice cost above receipt snapshot"));
  if (variance < 0) lines.push(credit("5100", -variance, "Invoice cost below receipt snapshot"));
  if (charge > 0) lines.push(debit(input.expenseAccountCode ?? "6000", charge, "Non-stock supplier charge"));
  if (input.invoiceAmountMinor + charge > 0) lines.push(credit("2000", input.invoiceAmountMinor + charge, "Supplier payable"));
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt ?? new Date(), description: "Posted supplier bill", lines });
}

export function buildSupplierReturnDraft(input: { currency: string; billedCostMinor: number; unbilledCostMinor: number; effectiveAt?: Date }): JournalDraft {
  requireAmount(input.billedCostMinor);
  requireAmount(input.unbilledCostMinor);
  const total = input.billedCostMinor + input.unbilledCostMinor;
  requireAmount(total);
  const lines: JournalLineDraft[] = [];
  if (input.billedCostMinor > 0) lines.push(debit("2000", input.billedCostMinor, "Supplier credit for billed receipt units"));
  if (input.unbilledCostMinor > 0) lines.push(debit("2220", input.unbilledCostMinor, "Clear unbilled receipt value"));
  if (total > 0) lines.push(credit("1400", total, "Returned inventory"));
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt ?? new Date(), description: "Posted supplier return", lines });
}

export function buildSupplierPaymentDraft(input: { currency: string; amountMinor: number; paidFromAccountCode: string; effectiveAt?: Date }): JournalDraft {
  requireAmount(input.amountMinor);
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt ?? new Date(), description: "Supplier payment", lines: [debit("2000", input.amountMinor), credit(input.paidFromAccountCode, input.amountMinor)] });
}

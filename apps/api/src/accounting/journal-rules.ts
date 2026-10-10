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
    if (!/^[0-9A-Z_-]{2,16}$/.test(line.accountCode)) invalid("ACCOUNTING_INVALID_ACCOUNT");
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
  discountMinor?: number;
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
  if ((input.loyaltyIssuedMinor ?? 0) > 0) lines.push(debit("6000", input.loyaltyIssuedMinor!, "Loyalty rewards expense"));
  const discountMinor = input.discountMinor ?? 0;
  requireAmount(discountMinor);
  if (discountMinor > 0) lines.push(debit("4020", discountMinor, "Sales discounts"));
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
  const loyaltyLiabilityMinor = input.loyaltyLiabilityMinor ?? 0;
  requireAmount(loyaltyLiabilityMinor);
  if (loyaltyLiabilityMinor > 0) lines.push(credit("6000", loyaltyLiabilityMinor, "Reverse loyalty rewards expense"));
  const restockedCostMinor = input.restockedCostMinor ?? 0;
  requireAmount(restockedCostMinor);
  if (restockedCostMinor > 0) lines.push(debit("1400", restockedCostMinor, "Restocked inventory"), credit("5000", restockedCostMinor, "Reverse cost of goods sold"));
  return buildBalancedDraft({ ...input, description: "Approved refund", lines });
}

export function buildExpenseDraft(input: { currency: string; amountMinor: number; expenseAccountCode: string; paidFromAccountCode: string; effectiveAt?: Date }): JournalDraft {
  requireAmount(input.amountMinor);
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt ?? new Date(), description: "Expense", lines: [debit(input.expenseAccountCode, input.amountMinor), credit(input.paidFromAccountCode, input.amountMinor)] });
}

export function buildStoredValueAdjustmentDraft(input: {
  currency: string;
  effectiveAt: Date;
  liabilityAccountCode: "2300" | "2310" | "2320";
  counterAccountCode: string;
  amountMinor: number;
  liabilityDeltaPositive: boolean;
  description: string;
}): JournalDraft {
  requireAmount(input.amountMinor);
  if (!input.counterAccountCode || input.counterAccountCode === input.liabilityAccountCode) invalid("ACCOUNTING_INVALID_ACCOUNT");
  return buildBalancedDraft({
    currency: input.currency,
    effectiveAt: input.effectiveAt,
    description: input.description,
    lines: input.liabilityDeltaPositive
      ? [debit(input.counterAccountCode, input.amountMinor), credit(input.liabilityAccountCode, input.amountMinor)]
      : [debit(input.liabilityAccountCode, input.amountMinor), credit(input.counterAccountCode, input.amountMinor)],
  });
}

export function buildInventoryMovementDraft(input: { currency: string; qtyDelta: number; unitCostMinor: number; movementType: "opening_stock" | "damage" | "adjustment"; effectiveAt: Date }): JournalDraft {
  if (!Number.isSafeInteger(input.qtyDelta) || input.qtyDelta === 0 || !safeMinor(input.unitCostMinor)) invalid("ACCOUNTING_INVALID_AMOUNT");
  const amount = Math.abs(input.qtyDelta) * input.unitCostMinor;
  requireAmount(amount);
  const sourceAccount = input.movementType === "opening_stock" ? "3000" : "6000";
  const positive = input.qtyDelta > 0;
  return buildBalancedDraft({
    currency: input.currency, effectiveAt: input.effectiveAt, description: input.movementType === "opening_stock" ? "Opening inventory" : "Inventory adjustment",
    lines: positive
      ? [debit("1400", amount), credit(sourceAccount, amount)]
      : [debit(sourceAccount, amount), credit("1400", amount)],
  });
}

export function buildStockCountDraft(input: { currency: string; effectiveAt: Date; variances: Array<{ productName: string; qtyDelta: number; unitCostMinor: number }> }): JournalDraft {
  const lines: JournalLineDraft[] = [];
  for (const row of input.variances) {
    if (!Number.isSafeInteger(row.qtyDelta) || row.qtyDelta === 0 || !safeMinor(row.unitCostMinor)) invalid("ACCOUNTING_INVALID_AMOUNT");
    const amount = Math.abs(row.qtyDelta) * row.unitCostMinor;
    requireAmount(amount);
    if (amount === 0) continue;
    lines.push(row.qtyDelta > 0
      ? debit("1400", amount, `Stock count gain: ${row.productName}`)
      : credit("1400", amount, `Stock count loss: ${row.productName}`));
    lines.push(row.qtyDelta > 0
      ? credit("6000", amount, `Stock count gain: ${row.productName}`)
      : debit("6000", amount, `Stock count loss: ${row.productName}`));
  }
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt, description: "Posted stock count", lines });
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

export function buildSupplierReturnDraft(input: { currency: string; billedReceiptCostMinor: number; billedInvoiceCostMinor: number; unbilledCostMinor: number; effectiveAt?: Date }): JournalDraft {
  requireAmount(input.billedReceiptCostMinor);
  requireAmount(input.billedInvoiceCostMinor);
  requireAmount(input.unbilledCostMinor);
  const total = input.billedReceiptCostMinor + input.unbilledCostMinor;
  requireAmount(total);
  const lines: JournalLineDraft[] = [];
  if (input.billedInvoiceCostMinor > 0) lines.push(debit("2000", input.billedInvoiceCostMinor, "Supplier credit for billed receipt units"));
  if (input.unbilledCostMinor > 0) lines.push(debit("2220", input.unbilledCostMinor, "Clear unbilled receipt value"));
  if (total > 0) lines.push(credit("1400", total, "Returned inventory"));
  const variance = input.billedInvoiceCostMinor - input.billedReceiptCostMinor;
  if (variance > 0) lines.push(credit("5100", variance, "Reverse purchase price variance"));
  if (variance < 0) lines.push(debit("5100", -variance, "Reverse purchase price variance"));
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt ?? new Date(), description: "Posted supplier return", lines });
}

export function buildSupplierPaymentDraft(input: { currency: string; amountMinor: number; paidFromAccountCode: string; effectiveAt?: Date }): JournalDraft {
  requireAmount(input.amountMinor);
  return buildBalancedDraft({ currency: input.currency, effectiveAt: input.effectiveAt ?? new Date(), description: "Supplier payment", lines: [debit("2000", input.amountMinor), credit(input.paidFromAccountCode, input.amountMinor)] });
}

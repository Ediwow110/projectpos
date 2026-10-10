import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BY_CODE,
  DEFAULT_ACCOUNTS,
  accountForMethod,
  buildBalancedDraft,
  buildExpenseDraft,
  buildPurchaseReceiptDraft,
  buildSaleDraft,
  buildSupplierBillDraft,
  buildSupplierPaymentDraft,
  buildSupplierReturnDraft,
  createSourceEventKey,
  validateJournalDraft,
} from "./journal-rules";

describe("management accounting journal rules", () => {
  it("defines the existing export account codes and explicit AP, GRNI and variance accounts", () => {
    expect(Object.keys(ACCOUNT_BY_CODE)).toEqual(expect.arrayContaining([
      "1000", "1400", "2100", "2110", "2120", "2000", "2200", "2210", "2220", "2300", "2310", "2320",
      "3000", "4000", "4010", "5000", "5100", "6000", "7000",
    ]));
    expect(DEFAULT_ACCOUNTS.every((account) => ["asset", "liability", "equity", "revenue", "expense"].includes(account.type))).toBe(true);
    expect(accountForMethod("cash")).toBe("1000");
    expect(accountForMethod("gcash")).toBe("2110");
    expect(accountForMethod("unknown")).toBe("2120");
  });

  it("validates two-line, one-currency, positive integer debit/credit entries", () => {
    const effectiveAt = new Date("2026-10-10T00:00:00.000Z");
    const draft = buildBalancedDraft({
      effectiveAt, currency: "PHP", description: "test",
      lines: [{ accountCode: "1000", debitMinor: 100, creditMinor: 0 }, { accountCode: "4000", debitMinor: 0, creditMinor: 100 }],
    });
    expect(validateJournalDraft(draft)).toEqual({ debitMinor: 100, creditMinor: 100 });
    expect(() => buildBalancedDraft({ effectiveAt, currency: "PHP", lines: [{ accountCode: "1000", debitMinor: 0, creditMinor: 0 }] })).toThrow("ACCOUNTING_INVALID_ENTRY");
    expect(() => buildBalancedDraft({ effectiveAt, currency: "PHP", lines: [{ accountCode: "1000", debitMinor: 1.5, creditMinor: 0 }, { accountCode: "4000", debitMinor: 0, creditMinor: 1.5 }] })).toThrow("ACCOUNTING_INVALID_AMOUNT");
    expect(() => buildBalancedDraft({ effectiveAt, currency: "PHP", lines: [{ accountCode: "1000", debitMinor: 1, creditMinor: 1 }, { accountCode: "4000", debitMinor: 0, creditMinor: 0 }] })).toThrow("ACCOUNTING_INVALID_AMOUNT");
    expect(() => buildBalancedDraft({ effectiveAt, currency: "PHP", lines: [{ accountCode: "1000", debitMinor: 100, creditMinor: 0 }, { accountCode: "4000", debitMinor: 0, creditMinor: 99 }] })).toThrow("ACCOUNTING_UNBALANCED_ENTRY");
    expect(() => buildBalancedDraft({ effectiveAt, currency: "bad", lines: [{ accountCode: "1000", debitMinor: 1, creditMinor: 0 }, { accountCode: "4000", debitMinor: 0, creditMinor: 1 }] })).toThrow("ACCOUNTING_INVALID_CURRENCY");
  });

  it("validates effective dates and source identity used for idempotency", () => {
    expect(() => buildBalancedDraft({ effectiveAt: new Date("invalid"), currency: "PHP", lines: [{ accountCode: "1000", debitMinor: 1, creditMinor: 0 }, { accountCode: "4000", debitMinor: 0, creditMinor: 1 }] })).toThrow("ACCOUNTING_INVALID_DATE");
    expect(createSourceEventKey({ businessId: "biz-1", sourceType: "Sale", sourceId: "sale-1", sourceEvent: "completed" })).toBe("biz-1:Sale:sale-1:completed");
    expect(() => createSourceEventKey({ businessId: "", sourceType: "Sale", sourceId: "sale-1", sourceEvent: "completed" })).toThrow("ACCOUNTING_INVALID_SOURCE");
  });

  it("balances sale tenders, revenue components, tax, stored value, change and snapshot COGS", () => {
    const draft = buildSaleDraft({ currency: "PHP", effectiveAt: new Date("2026-10-10T00:00:00Z"), tenders: [{ method: "cash", amountMinor: 900 }, { method: "card", amountMinor: 400 }], changeMinor: 100, merchandiseRevenueMinor: 900, deliveryFeeMinor: 100, taxPayableMinor: 100, giftCardLoadMinor: 100, cogsMinor: 500 });
    expect(validateJournalDraft(draft)).toEqual({ debitMinor: 1800, creditMinor: 1800 });
    expect(draft.lines).toContainEqual(expect.objectContaining({ accountCode: "5000", debitMinor: 500 }));
    expect(draft.lines).toContainEqual(expect.objectContaining({ accountCode: "1400", creditMinor: 500 }));
  });

  it("balances expense and receipt drafts without reclassifying receipt cost as COGS", () => {
    expect(validateJournalDraft(buildExpenseDraft({ currency: "PHP", amountMinor: 250, expenseAccountCode: "6000", paidFromAccountCode: "1000" }))).toEqual({ debitMinor: 250, creditMinor: 250 });
    const receipt = buildPurchaseReceiptDraft({ currency: "PHP", inventoryCostMinor: 800 });
    expect(validateJournalDraft(receipt)).toEqual({ debitMinor: 800, creditMinor: 800 });
    expect(receipt.lines).toContainEqual(expect.objectContaining({ accountCode: "1400", debitMinor: 800 }));
    expect(receipt.lines).toContainEqual(expect.objectContaining({ accountCode: "2220", creditMinor: 800 }));
  });

  it("balances bill variance, billed and unbilled returns, and supplier payments", () => {
    const higherInvoice = buildSupplierBillDraft({ currency: "PHP", receiptCostMinor: 800, invoiceAmountMinor: 850 });
    expect(validateJournalDraft(higherInvoice)).toEqual({ debitMinor: 850, creditMinor: 850 });
    expect(higherInvoice.lines).toContainEqual(expect.objectContaining({ accountCode: "5100", debitMinor: 50 }));
    const lowerInvoice = buildSupplierBillDraft({ currency: "PHP", receiptCostMinor: 800, invoiceAmountMinor: 750, nonStockChargeMinor: 100 });
    expect(validateJournalDraft(lowerInvoice)).toEqual({ debitMinor: 900, creditMinor: 900 });
    expect(lowerInvoice.lines).toContainEqual(expect.objectContaining({ accountCode: "5100", creditMinor: 50 }));
    expect(validateJournalDraft(buildSupplierReturnDraft({ currency: "PHP", billedCostMinor: 300, unbilledCostMinor: 200 }))).toEqual({ debitMinor: 500, creditMinor: 500 });
    expect(validateJournalDraft(buildSupplierPaymentDraft({ currency: "PHP", amountMinor: 500, paidFromAccountCode: "1000" }))).toEqual({ debitMinor: 500, creditMinor: 500 });
  });
});

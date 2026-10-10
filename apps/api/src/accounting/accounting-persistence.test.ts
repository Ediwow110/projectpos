import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";

const account = (businessId: string, code: string) => ({ businessId, code, name: `Account ${code}`, type: "asset", normalSide: "debit", isSystem: code === "1000", isActive: true });

describe("memory accounting persistence", () => {
  it("scopes accounts and journal entries by business and returns immutable posted rows", async () => {
    const db = createMemoryDb();
    const a = await db.createBusiness({ name: "A", currency: "PHP" });
    const b = await db.createBusiness({ name: "B", currency: "PHP" });
    const cash = await db.createAccountingAccount(account(a.id, "1000"));
    const revenue = await db.createAccountingAccount({ ...account(a.id, "4000"), type: "revenue", normalSide: "credit", isSystem: true });
    const otherTenant = await db.createAccountingAccount(account(b.id, "1000"));
    const created = await db.createJournalEntry({
      businessId: a.id, branchId: null, sourceType: "Sale", sourceId: "sale-1", sourceEvent: "completed",
      effectiveAt: new Date("2026-10-10T12:00:00Z"), currency: "PHP", description: "Sale", actorId: "u1", requestId: "r1", reversesEntryId: null,
      lines: [{ accountId: cash.id, debitMinor: 100, creditMinor: 0 }, { accountId: revenue.id, debitMinor: 0, creditMinor: 100 }],
    });
    expect(await db.findJournalEntryBySource(a.id, "Sale", "sale-1", "completed")).toEqual(created);
    expect(await db.findJournalEntryBySource(b.id, "Sale", "sale-1", "completed")).toBeNull();
    await expect(db.createJournalEntry({
      businessId: a.id, branchId: null, sourceType: "Sale", sourceId: "sale-1", sourceEvent: "completed",
      effectiveAt: new Date(), currency: "PHP", description: "duplicate", actorId: "u1", requestId: "r2", reversesEntryId: null,
      lines: [{ accountId: cash.id, debitMinor: 100, creditMinor: 0 }, { accountId: revenue.id, debitMinor: 0, creditMinor: 100 }],
    })).rejects.toThrow("CONFLICT");
    await expect(db.createJournalEntry({
      businessId: a.id, branchId: null, sourceType: "Sale", sourceId: "sale-2", sourceEvent: "completed",
      effectiveAt: new Date(), currency: "PHP", description: "bad tenant account", actorId: "u1", requestId: "r3", reversesEntryId: null,
      lines: [{ accountId: otherTenant.id, debitMinor: 100, creditMinor: 0 }, { accountId: revenue.id, debitMinor: 0, creditMinor: 100 }],
    })).rejects.toThrow("ACCOUNTING_INVALID_ACCOUNT");
    expect(await db.isAccountingAccountUsed(a.id, cash.id)).toBe(true);
    expect(await db.findJournalEntryById(created.entry.id, b.id)).toBeNull();
    expect(await db.listJournalLines(created.entry.id, a.id)).toHaveLength(2);
  });

  it("rolls back journal headers and lines with the surrounding transaction", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Rollback", currency: "PHP" });
    const debit = await db.createAccountingAccount(account(business.id, "1000"));
    const credit = await db.createAccountingAccount({ ...account(business.id, "4000"), type: "revenue", normalSide: "credit" });
    await expect(db.withTransaction(async (tx) => {
      await tx.createJournalEntry({
        businessId: business.id, branchId: null, sourceType: "Sale", sourceId: "sale-rollback", sourceEvent: "completed",
        effectiveAt: new Date(), currency: "PHP", description: "rollback", actorId: "u1", requestId: "r1", reversesEntryId: null,
        lines: [{ accountId: debit.id, debitMinor: 10, creditMinor: 0 }, { accountId: credit.id, debitMinor: 0, creditMinor: 10 }],
      });
      throw new Error("injected source failure");
    })).rejects.toThrow("injected source failure");
    expect(await db.findJournalEntryBySource(business.id, "Sale", "sale-rollback", "completed")).toBeNull();
    expect(await db.isAccountingAccountUsed(business.id, debit.id)).toBe(false);
  });

  it("tracks posted supplier allocations, credits, and idempotent payment identity", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "AP", currency: "PHP" });
    const now = new Date("2026-10-10T12:00:00Z");
    const bill = await db.createSupplierBill({
      businessId: business.id, supplierId: "supplier-1", branchId: null, invoiceNumber: "INV-1", invoiceDate: now, dueDate: null,
      currency: "PHP", status: "POSTED", invoiceAmountMinor: 900, nonStockChargeMinor: 0, paidMinor: 0, version: 1,
      notes: null, createdBy: "owner", postedBy: "owner", postedAt: now, voidedBy: null, voidedAt: null, requestId: "req-1",
    });
    await db.createSupplierBillAllocation({ businessId: business.id, billId: bill.id, receiptLineId: "receipt-line-1", quantity: 3, unitInvoiceCostMinor: 300, invoiceAmountMinor: 900, receiptCostMinorSnapshot: 750 });
    expect(await db.billedQuantityByReceiptLine(business.id, "receipt-line-1")).toBe(3);
    expect(await db.billedQuantityByReceiptLine("other-tenant", "receipt-line-1")).toBe(0);
    const version2 = await db.updateSupplierBill(bill.id, business.id, { paidMinor: 250, status: "PARTIALLY_PAID" }, 1);
    expect(version2?.version).toBe(2);
    expect(await db.updateSupplierBill(bill.id, business.id, { paidMinor: 300 }, 1)).toBeNull();
    const payment = { businessId: business.id, supplierId: "supplier-1", billId: bill.id, branchId: null, amountMinor: 250, method: "bank_transfer", paidFromAccountId: "account-1", reference: null, paidAt: now, shiftId: null, cashMovementId: null, idempotencyKey: "pay-1", createdBy: "owner", requestId: "req-2" };
    await db.createSupplierPayment(payment);
    await expect(db.createSupplierPayment(payment)).rejects.toThrow("CONFLICT");
  });
});

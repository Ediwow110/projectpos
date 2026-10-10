import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";

describe("phase23 pg accounting persistence", () => {
  it("stores tenant-scoped accounts and balanced source entries with exact minor units", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const business = await db.createBusiness({ name: "Accounting PG", currency: "PHP" });
      const cash = await db.createAccountingAccount({ businessId: business.id, code: "1000", name: "Cash", type: "asset", normalSide: "debit", isSystem: true, isActive: true });
      const revenue = await db.createAccountingAccount({ businessId: business.id, code: "4000", name: "Revenue", type: "revenue", normalSide: "credit", isSystem: true, isActive: true });
      const posted = await db.createJournalEntry({
        businessId: business.id, branchId: null, sourceType: "Sale", sourceId: "pg-sale-1", sourceEvent: "completed",
        effectiveAt: new Date("2026-10-10T12:00:00Z"), currency: "PHP", description: "Sale", actorId: "u1", requestId: "r1", reversesEntryId: null,
        lines: [{ accountId: cash.id, debitMinor: 1_234_567, creditMinor: 0 }, { accountId: revenue.id, debitMinor: 0, creditMinor: 1_234_567 }],
      });
      expect(posted.lines.map((line: { debitMinor: number; creditMinor: number }) => [line.debitMinor, line.creditMinor])).toEqual([[1_234_567, 0], [0, 1_234_567]]);
      expect(await db.findJournalEntryBySource(business.id, "Sale", "pg-sale-1", "completed")).toEqual(posted);
      expect((await db.listJournalEntries(business.id, { dateFrom: new Date("2026-10-10T00:00:00Z"), dateTo: new Date("2026-10-10T23:59:59Z"), accountId: cash.id, limit: 50 })).map((entry: { id: string }) => entry.id)).toEqual([posted.entry.id]);
      await expect(db.createJournalEntry({
        businessId: business.id, branchId: null, sourceType: "Sale", sourceId: "pg-sale-1", sourceEvent: "completed",
        effectiveAt: new Date(), currency: "PHP", description: "duplicate", actorId: "u1", requestId: "r2", reversesEntryId: null,
        lines: [{ accountId: cash.id, debitMinor: 1, creditMinor: 0 }, { accountId: revenue.id, debitMinor: 0, creditMinor: 1 }],
      })).rejects.toThrow("CONFLICT");
      expect(await db.isAccountingAccountUsed(business.id, cash.id)).toBe(true);
    });
  });

  it("stores supplier bills and prevents duplicate payment idempotency keys", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const business = await db.createBusiness({ name: "AP PG", currency: "PHP" });
      const supplier = await db.createSupplier({ businessId: business.id, name: "Beans Ltd", code: null, contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, province: null, postalCode: null, country: "PH", paymentTerms: null, notes: null, isActive: true });
      const account = await db.createAccountingAccount({ businessId: business.id, code: "1000", name: "Cash", type: "asset", normalSide: "debit", isSystem: true, isActive: true });
      const now = new Date("2026-10-10T12:00:00Z");
      const bill = await db.createSupplierBill({ businessId: business.id, supplierId: supplier.id, branchId: null, invoiceNumber: "INV-1", invoiceDate: now, dueDate: null, currency: "PHP", status: "POSTED", invoiceAmountMinor: 900, nonStockChargeMinor: 0, paidMinor: 0, version: 1, notes: null, createdBy: "owner", postedBy: "owner", postedAt: now, voidedBy: null, voidedAt: null, requestId: "r1" });
      expect((await db.findSupplierBill(bill.id, business.id))?.invoiceAmountMinor).toBe(900);
      expect(await db.updateSupplierBill(bill.id, business.id, { status: "PARTIALLY_PAID", paidMinor: 400 }, 1)).toMatchObject({ version: 2, paidMinor: 400 });
      const payment = { businessId: business.id, supplierId: supplier.id, billId: bill.id, branchId: null, amountMinor: 400, method: "cash", paidFromAccountId: account.id, reference: null, paidAt: now, shiftId: null, cashMovementId: null, idempotencyKey: "pay-1", createdBy: "owner", requestId: "r2" };
      await db.createSupplierPayment(payment);
      await expect(db.createSupplierPayment(payment)).rejects.toThrow("CONFLICT");
      expect((await db.listSupplierPayments(bill.id, business.id))[0]?.amountMinor).toBe(400);
    });
  });
});

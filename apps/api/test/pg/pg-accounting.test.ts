import { describe, expect, it } from "vitest";
import { StoredValueService } from "../../src/value/stored-value.service";
import { JournalPostingService } from "../../src/accounting/journal-posting.service";
import { buildBalancedDraft } from "../../src/accounting/journal-rules";
import { withPg } from "./helpers";

describe("phase23 pg accounting persistence", () => {
  it("posts direct stored-value adjustment with an explicit counter account in the same PostgreSQL transaction", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const business = await db.createBusiness({ name: "Stored value PG", currency: "PHP" });
      const issued = await new StoredValueService(db).issueGiftCard(business.id, "owner", "pg-issue", "pg-issue-001");
      await new StoredValueService(db).adjustGiftCard(business.id, "owner", "pg-adjust", issued.card.id, 500, "Opening customer balance correction", "6000", "pg-adjust-001");
      const entries = await db.listJournalEntries(business.id, { limit: 10 });
      expect(entries).toHaveLength(1);
      expect((await db.listJournalLines(entries[0]!.id, business.id)).map((line: { debitMinor: number; creditMinor: number }) => [line.debitMinor, line.creditMinor])).toEqual([[500, 0], [0, 500]]);
      expect(await db.hasUnaccountedValueAdjustments(business.id)).toBe(false);
    });
  });
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
      expect(await db.aggregateJournalAccountTotals(business.id, { dateFrom: new Date("2026-10-10T00:00:00Z"), dateTo: new Date("2026-10-11T00:00:00Z") })).toMatchObject([
        { account: { code: "1000" }, debitMinor: 1_234_567, creditMinor: 0 },
        { account: { code: "4000" }, debitMinor: 0, creditMinor: 1_234_567 },
      ]);
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

  it("persists tenant-scoped opening activation state", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const business = await db.createBusiness({ name: "Activation PG", currency: "PHP" });
      const cash = await db.createAccountingAccount({ businessId: business.id, code: "1000", name: "Cash", type: "asset", normalSide: "debit", isSystem: true, isActive: true });
      const equity = await db.createAccountingAccount({ businessId: business.id, code: "3000", name: "Equity", type: "equity", normalSide: "credit", isSystem: true, isActive: true });
      const opening = await db.createJournalEntry({ businessId: business.id, branchId: null, sourceType: "AccountingOpening", sourceId: business.id, sourceEvent: "opening-balance", effectiveAt: new Date("2026-01-01T00:00:00Z"), currency: "PHP", description: "Opening", actorId: "owner", requestId: "opening-pg-1", reversesEntryId: null, lines: [{ accountId: cash.id, debitMinor: 500, creditMinor: 0 }, { accountId: equity.id, debitMinor: 0, creditMinor: 500 }] });
      const activation = await db.saveAccountingActivation({ businessId: business.id, status: "REVIEW", accountingStartAt: new Date("2026-01-01T00:00:00Z"), openingEntryId: opening.entry.id, csvCutoverAt: null });
      expect(activation).toMatchObject({ businessId: business.id, status: "REVIEW", openingEntryId: opening.entry.id });
      expect(await db.findAccountingActivation(business.id)).toEqual(activation);
      const other = await db.createBusiness({ name: "Activation PG other", currency: "PHP" });
      expect(await db.findAccountingActivation(other.id)).toBeNull();
    });
  });

  it("persists bounded backfill run state and deduplicates issue records", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const business = await db.createBusiness({ name: "Backfill PG", currency: "PHP" });
      const run = await db.createAccountingBackfillRun({ businessId: business.id, status: "RUNNING", cursor: { family: "sales", afterId: "sale-1" }, processedCount: 10, skippedCount: 0, debitMinor: 500, creditMinor: 500, startedAt: new Date(), completedAt: null, createdBy: "owner", requestId: "backfill-1" });
      expect(await db.findAccountingBackfillRun(run.id, business.id)).toMatchObject({ status: "RUNNING", cursor: { family: "sales", afterId: "sale-1" }, processedCount: 10 });
      const issueInput = { businessId: business.id, runId: run.id, sourceType: "InventoryMovement", sourceId: "movement-1", reason: "historical_cost_missing" };
      const first = await db.createAccountingBackfillIssue(issueInput);
      const duplicate = await db.createAccountingBackfillIssue(issueInput);
      expect(duplicate.id).toBe(first.id);
      expect(await db.listAccountingBackfillIssues(run.id, business.id, 10)).toHaveLength(1);
      const actor = await db.createUser({ name: "Accounting owner", email: `backfill-${Date.now()}@pg.test`, passwordHash: "hash" });
      const posted = await new JournalPostingService(db).postSourceEvent({ businessId: business.id, branchId: null, sourceType: "AccountingBackfillResolution", sourceId: first.id, sourceEvent: first.reason, actorId: actor.id, requestId: "resolve-backfill", draft: buildBalancedDraft({ currency: "PHP", effectiveAt: new Date(), lines: [{ accountCode: "1400", debitMinor: 100, creditMinor: 0 }, { accountCode: "6000", debitMinor: 0, creditMinor: 100 }] }) });
      const resolved = await db.resolveAccountingBackfillIssue({ issueId: first.id, runId: run.id, businessId: business.id, actorId: actor.id, entryId: posted.entry.id, evidence: "Supplier invoice INV-1" });
      expect(resolved).toMatchObject({ resolvedBy: actor.id, resolutionEntryId: posted.entry.id, resolutionEvidence: "Supplier invoice INV-1" });
      expect(await db.countAccountingBackfillIssues(run.id, business.id)).toBe(0);
    });
  });

  it("rejects journal lines that reference an account owned by another business", async () => {
    await withPg(async (raw, ctx) => {
      const db = raw as any;
      const business = await db.createBusiness({ name: "Journal tenant", currency: "PHP" });
      const otherBusiness = await db.createBusiness({ name: "Other journal tenant", currency: "PHP" });
      const foreignAccount = await db.createAccountingAccount({ businessId: otherBusiness.id, code: "1000", name: "Cash", type: "asset", normalSide: "debit", isSystem: true, isActive: true });
      const client = await ctx.client();
      await client.query("BEGIN");
      try {
        await client.query(
          'INSERT INTO "JournalEntry" ("id","businessId","sourceType","sourceId","sourceEvent","effectiveAt","currency","description","actorId","requestId") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,$6,$7,$8,$9)',
          ["jrn_cross_tenant", business.id, "Sale", "foreign-account", "completed", "PHP", "Must fail", "u1", "r1"],
        );
        await expect(client.query(
          'INSERT INTO "JournalLine" ("id","businessId","entryId","accountId","debitMinor","creditMinor","position") VALUES ($1,$2,$3,$4,10,0,0)',
          ["jln_cross_tenant", business.id, "jrn_cross_tenant", foreignAccount.id],
        )).rejects.toThrow("ACCOUNTING_LINE_TENANT_MISMATCH");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect(await db.findJournalEntryBySource(business.id, "Sale", "foreign-account", "completed")).toBeNull();
    });
  });

  it("pages receipts, supplier returns, and inventory counts by stable tenant cursor", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const business = await db.createBusiness({ name: "Backfill page PG", currency: "PHP" });
      const foreign = await db.createBusiness({ name: "Backfill page foreign", currency: "PHP" });
      const card = await db.createGiftCard({ businessId: business.id, codeHash: "pg-adjustment-hash", codePrefix: "PG", codeLast4: "0001", status: "ACTIVE", createdBy: "owner", activatedAt: new Date(), suspendedAt: null, version: 1 });
      await db.createGiftCardTransaction({ businessId: business.id, giftCardId: card.id, type: "ADJUST_CREDIT", amountDeltaMinor: 100, saleId: null, refundId: null, actorId: "owner", requestId: "pg-value-adjust", idempotencyKey: "pg-value-adjust", reason: "Manual adjustment", branchId: null });
      expect(await db.hasUnaccountedValueAdjustments(business.id)).toBe(true);
      expect(await db.hasUnaccountedValueAdjustments(business.id, new Date(Date.now() + 5_000))).toBe(false);
      expect(await db.hasUnaccountedValueAdjustments(foreign.id)).toBe(false);
      const supplier = await db.createSupplier({ businessId: business.id, name: "Page supplier", code: "PAGE", contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, province: null, postalCode: null, country: "PH", paymentTerms: null, notes: null, isActive: true });
      const order = await db.createPurchaseOrder({ businessId: business.id, supplierId: supplier.id, branchId: null, poNumber: "PG-PAGE-1", status: "DRAFT", expectedDate: null, notes: null, subtotalMinor: 0, taxMinor: 0, totalMinor: 0, createdBy: "owner", orderedBy: null, orderedAt: null, cancelledBy: null, cancelledAt: null, cancelReason: null });
      const receiptInput = (receiptNumber: string) => ({ businessId: business.id, purchaseOrderId: order.id, branchId: null, receiptNumber, status: "DRAFT", receivedBy: "owner", receivedAt: new Date("2026-10-10T00:00:00Z"), notes: null });
      const receipts = await Promise.all([db.createPurchaseReceipt(receiptInput("PG-GRN-1")), db.createPurchaseReceipt(receiptInput("PG-GRN-2"))]);
      const supplierReturn = (returnNumber: string) => ({ businessId: business.id, supplierId: supplier.id, purchaseOrderId: order.id, branchId: null, returnNumber, status: "DRAFT", reason: "test", createdBy: "owner", postedBy: null, postedAt: null, cancelledBy: null, cancelledAt: null, version: 1 });
      const returns = await Promise.all([db.createSupplierReturn(supplierReturn("PG-RET-1")), db.createSupplierReturn(supplierReturn("PG-RET-2"))]);
      const bill = (invoiceNumber: string) => ({ businessId: business.id, supplierId: supplier.id, branchId: null, invoiceNumber, invoiceDate: new Date("2026-10-10T00:00:00Z"), dueDate: null, currency: "PHP", status: "DRAFT", invoiceAmountMinor: 0, nonStockChargeMinor: 0, paidMinor: 0, version: 1, notes: null, createdBy: "owner", postedBy: null, postedAt: null, voidedBy: null, voidedAt: null, requestId: invoiceNumber });
      const bills = await Promise.all([db.createSupplierBill(bill("PG-INV-1")), db.createSupplierBill(bill("PG-INV-2"))]);
      const credit = await db.createSupplierCredit({ businessId: business.id, supplierId: supplier.id, billId: null, supplierReturnId: returns[0]!.id, creditNumber: "PG-CN-1", amountMinor: 100, status: "POSTED", createdBy: "owner", requestId: "pg-credit" });
      expect((await db.listUnappliedSupplierCredits(business.id)).map((row: { id: string }) => row.id)).toEqual([credit.id]);
      expect(await db.updateSupplierCredit(credit.id, business.id, { billId: bills[0]!.id, status: "APPLIED" })).toMatchObject({ billId: bills[0]!.id, status: "APPLIED" });
      const count = (countNumber: string) => ({ businessId: business.id, branchId: null, countNumber, status: "DRAFT", scopeType: "FULL", name: countNumber, notes: null, createdBy: "owner", startedAt: null, submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, approvalFingerprint: null, postedBy: null, postedAt: null, cancelledBy: null, cancelledAt: null, version: 1 });
      const counts = await Promise.all([db.createInventoryCount(count("PG-CNT-1")), db.createInventoryCount(count("PG-CNT-2"))]);

      const receiptPage = await db.listPurchaseReceiptsPage(business.id, null, 1);
      expect(receiptPage).toHaveLength(1);
      expect((await db.listPurchaseReceiptsPage(business.id, receiptPage[0]!.id, 10)).map((row: { id: string }) => row.id)).toEqual([receipts.filter((row: { businessId: string }) => row.businessId === business.id).map((row: { id: string }) => row.id).sort()[1]]);
      expect(await db.listPurchaseReceiptsPage(foreign.id, null, 10)).toHaveLength(0);

      const returnPage = await db.listSupplierReturnsPage(business.id, null, 1);
      expect(returnPage).toHaveLength(1);
      expect((await db.listSupplierReturnsPage(business.id, returnPage[0]!.id, 10)).map((row: { id: string }) => row.id)).toEqual([returns.map((row: { id: string }) => row.id).sort()[1]]);

      const billPage = await db.listSupplierBillsPage(business.id, null, 1);
      expect(billPage).toHaveLength(1);
      expect((await db.listSupplierBillsPage(business.id, billPage[0]!.id, 10)).map((row: { id: string }) => row.id)).toEqual([bills.map((row: { id: string }) => row.id).sort()[1]]);

      const countPage = await db.listInventoryCountsPage(business.id, null, 1);
      expect(countPage).toHaveLength(1);
      expect((await db.listInventoryCountsPage(business.id, countPage[0]!.id, 10)).map((row: { id: string }) => row.id)).toEqual([counts.map((row: { id: string }) => row.id).sort()[1]]);
    });
  });
});

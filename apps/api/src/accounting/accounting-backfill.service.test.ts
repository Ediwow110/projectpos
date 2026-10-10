import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { AccountingBackfillService } from "./accounting-backfill.service";
import { StoredValueService } from "../value/stored-value.service";

describe("AccountingBackfillService cutover date", () => {
  it("resolves legacy gift, store-credit, and loyalty adjustments with evidenced counter accounts in bounded batches", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Stored value backfill", currency: "PHP" });
    const customer = await db.createCustomer({ businessId: business.id, name: "Legacy Customer", phone: null, email: null, address: null, notes: null, isActive: true });
    const startAt = new Date("2026-01-01T00:00:00.000Z");
    await db.saveAccountingActivation({ businessId: business.id, status: "BACKFILLING", accountingStartAt: startAt, openingEntryId: "opening-entry", csvCutoverAt: null });
    const run = await db.createAccountingBackfillRun({ businessId: business.id, status: "PAUSED", cursor: { family: "remaining", afterId: null }, processedCount: 0, skippedCount: 3, debitMinor: 0, creditMinor: 0, startedAt: new Date(), completedAt: new Date(), createdBy: "owner", requestId: "stored-value-run" });
    const issue = await db.createAccountingBackfillIssue({ businessId: business.id, runId: run.id, sourceType: "StoredValue", sourceId: business.id, reason: "standalone_value_adjustment_counter_account_missing" });
    const valueService = new StoredValueService(db);
    const card = (await valueService.issueGiftCard(business.id, "owner", "legacy-gift", "legacy-gift-issue")).card;
    const gift = await db.createGiftCardTransaction({ businessId: business.id, giftCardId: card.id, type: "ADJUST_CREDIT", amountDeltaMinor: 500, saleId: null, refundId: null, actorId: "owner", requestId: "legacy-gift-adjust", idempotencyKey: "legacy-gift-adjust", reason: "Legacy documented adjustment", branchId: null });
    const storeAccount = await valueService.ensureStoreCreditAccount(business.id, customer.id);
    const store = await db.createStoreCreditTransaction({ businessId: business.id, accountId: storeAccount.id, customerId: customer.id, type: "MANUAL_CREDIT", amountDeltaMinor: 250, saleId: null, refundId: null, actorId: "owner", requestId: "legacy-store-adjust", idempotencyKey: "legacy-store-adjust", reason: "Legacy store correction", branchId: null });
    const loyaltyAccount = await valueService.ensureLoyaltyAccount(business.id, customer.id);
    const loyalty = await db.createLoyaltyTransaction({ businessId: business.id, accountId: loyaltyAccount.id, customerId: customer.id, type: "MANUAL_CREDIT", pointsDelta: 10, valueMinorSnapshot: null, saleId: null, refundId: null, actorId: "owner", requestId: "legacy-loyalty-adjust", idempotencyKey: "legacy-loyalty-adjust", reason: "Legacy points correction" });
    const service = new AccountingBackfillService(db);
    expect((await service.storedValueIssueDetails(business.id, startAt)).map((row) => row.sourceId)).toHaveLength(3);
    const partial = await service.resolveStoredValueIssue({ businessId: business.id, runId: run.id, issueId: issue.id, actorId: "owner", requestId: "stored-value-resolution-1", evidence: "Archive adjustment register, page 4", storedValueAdjustments: [
      { sourceType: "GiftCardTransaction", sourceId: gift.id, counterAccountCode: "6000" },
      { sourceType: "StoreCreditTransaction", sourceId: store.id, counterAccountCode: "6000" },
    ] });
    expect(partial).toEqual({ resolved: false, remainingCount: 1 });
    expect(await db.countAccountingBackfillIssues(run.id, business.id)).toBe(1);
    const completed = await service.resolveStoredValueIssue({ businessId: business.id, runId: run.id, issueId: issue.id, actorId: "owner", requestId: "stored-value-resolution-2", evidence: "Archive adjustment register, page 5", storedValueAdjustments: [{ sourceType: "LoyaltyTransaction", sourceId: loyalty.id, counterAccountCode: "6000", amountMinor: 125 }] });
    expect(completed).toEqual({ resolved: true, remainingCount: 0 });
    expect(await db.countAccountingBackfillIssues(run.id, business.id)).toBe(0);
    expect((await db.findJournalEntryBySource(business.id, "GiftCardTransaction", gift.id, "adjusted"))?.entry.currency).toBe("PHP");
    expect((await db.findJournalEntryBySource(business.id, "LoyaltyTransaction", loyalty.id, "adjusted"))?.lines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(125);
    const resolutionAudit = (await db.listAudit()).filter((entry) => entry.entityId === issue.id && entry.action.startsWith("accounting.backfill_issue."));
    expect(resolutionAudit.map((entry) => entry.action).sort()).toEqual(["accounting.backfill_issue.resolution_batch", "accounting.backfill_issue.resolved"]);
  });

  it("covers pre-cutover inventory history with opening balances and keeps later cost gaps unresolved", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Backfill cutover", currency: "PHP" });
    const startAt = new Date("2026-01-01T00:00:00.000Z");
    await db.saveAccountingActivation({ businessId: business.id, status: "BACKFILLING", accountingStartAt: startAt, openingEntryId: "opening-entry", csvCutoverAt: null });
    const oldMovement = await db.createMovement({ businessId: business.id, productId: "legacy-product", type: "adjustment", qtyDelta: 2, reason: "Old stock correction", referenceType: null, referenceId: null, actorId: "owner", requestId: "old-movement", branchId: null, createdAt: new Date("2025-12-31T23:59:59.999Z") });
    const currentMovement = await db.createMovement({ businessId: business.id, productId: "current-product", type: "adjustment", qtyDelta: -1, reason: "Current stock correction", referenceType: null, referenceId: null, actorId: "owner", requestId: "current-movement", branchId: null, createdAt: new Date("2026-02-01T00:00:00.000Z") });
    const run = await db.createAccountingBackfillRun({ businessId: business.id, status: "RUNNING", cursor: { family: "inventory-movements", afterId: null }, processedCount: 0, skippedCount: 0, debitMinor: 0, creditMinor: 0, startedAt: new Date(), completedAt: null, createdBy: "owner", requestId: "cutover-run" });

    const updated = await new AccountingBackfillService(db).runBatch({ businessId: business.id, runId: run.id, actorId: "owner", requestId: "cutover-batch", expectedCursor: { family: "inventory-movements", afterId: null } });
    const issues = await db.listAccountingBackfillIssues(run.id, business.id, 20);

    expect(updated.skippedCount).toBe(1);
    expect(issues).toEqual([expect.objectContaining({ sourceId: currentMovement.id, reason: "historical_movement_cost_unavailable" })]);
    expect(issues.some((issue) => issue.sourceId === oldMovement.id)).toBe(false);
  });

  it("resolves an unsupported movement from documented unit cost without changing inventory quantity", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Backfill resolution", currency: "PHP" });
    const movement = await db.createMovement({ businessId: business.id, productId: "sku-a", type: "damage", qtyDelta: -2, reason: "Broken units", referenceType: null, referenceId: null, actorId: "owner", requestId: "damaged-stock", branchId: null, createdAt: new Date("2026-02-01T00:00:00.000Z") });
    const run = await db.createAccountingBackfillRun({ businessId: business.id, status: "PAUSED", cursor: { family: "remaining", afterId: null }, processedCount: 0, skippedCount: 1, debitMinor: 0, creditMinor: 0, startedAt: new Date(), completedAt: new Date(), createdBy: "owner", requestId: "resolution-run" });
    const issue = await db.createAccountingBackfillIssue({ businessId: business.id, runId: run.id, sourceType: "InventoryMovement", sourceId: movement.id, reason: "historical_movement_cost_unavailable" });
    const service = new AccountingBackfillService(db);
    const input = { businessId: business.id, runId: run.id, issueId: issue.id, actorId: "owner", requestId: "movement-cost-resolution", evidence: "Supplier invoice INV-42", unitCostMinor: 250 };

    const resolved = await service.resolveInventoryIssue(input);
    const replay = await service.resolveInventoryIssue(input);

    expect(resolved.entry).toMatchObject({ sourceType: "AccountingBackfillResolution", sourceId: issue.id, sourceEvent: issue.reason });
    expect(replay.entry).toMatchObject({ id: (resolved.entry as { id: string }).id });
    expect(await db.countAccountingBackfillIssues(run.id, business.id)).toBe(0);
    expect(await db.listMovementsByBusiness(business.id)).toEqual([movement]);
    const expense = await db.findAccountingAccountByCode(business.id, "6000");
    const inventory = await db.findAccountingAccountByCode(business.id, "1400");
    expect((await db.findJournalEntryBySource(business.id, "AccountingBackfillResolution", issue.id, issue.reason))?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: expense?.id, debitMinor: 500, creditMinor: 0 }),
      expect.objectContaining({ accountId: inventory?.id, debitMinor: 0, creditMinor: 500 }),
    ]));
  });

  it("resolves a posted count using a separately evidenced cost for each variance line", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Count resolution", currency: "PHP" });
    const count = await db.createInventoryCount({ businessId: business.id, branchId: null, countNumber: "COUNT-1", status: "POSTED", scopeType: "PARTIAL", name: "Opening reconciliation", notes: null, createdBy: "owner", startedAt: new Date(), submittedBy: "owner", submittedAt: new Date(), approvedBy: "owner", approvedAt: new Date(), approvalFingerprint: "approved", postedBy: "owner", postedAt: new Date("2026-02-01T00:00:00Z"), cancelledBy: null, cancelledAt: null, version: 1 });
    const positive = await db.createInventoryCountLine({ businessId: business.id, inventoryCountId: count.id, productId: "sku-a", expectedQtySnapshot: 1, balanceUpdatedAtSnapshot: null, countedQty: 3, varianceQty: 2, productNameSnapshot: "Product A", skuSnapshot: "A", notes: null, countedBy: "owner", countedAt: new Date() });
    const negative = await db.createInventoryCountLine({ businessId: business.id, inventoryCountId: count.id, productId: "sku-b", expectedQtySnapshot: 4, balanceUpdatedAtSnapshot: null, countedQty: 3, varianceQty: -1, productNameSnapshot: "Product B", skuSnapshot: "B", notes: null, countedBy: "owner", countedAt: new Date() });
    const run = await db.createAccountingBackfillRun({ businessId: business.id, status: "PAUSED", cursor: { family: "remaining", afterId: null }, processedCount: 0, skippedCount: 1, debitMinor: 0, creditMinor: 0, startedAt: new Date(), completedAt: new Date(), createdBy: "owner", requestId: "count-resolution-run" });
    const issue = await db.createAccountingBackfillIssue({ businessId: business.id, runId: run.id, sourceType: "InventoryCount", sourceId: count.id, reason: "historical_count_cost_unavailable" });
    const beforeLines = await db.listInventoryCountLines(count.id, business.id);
    const result = await new AccountingBackfillService(db).resolveInventoryIssue({ businessId: business.id, runId: run.id, issueId: issue.id, actorId: "owner", requestId: "count-cost-resolution", evidence: "Signed count sheet 2026-02-01", lineCosts: [{ lineId: positive.id, unitCostMinor: 125 }, { lineId: negative.id, unitCostMinor: 350 }] });

    expect(result.entry).toMatchObject({ sourceType: "AccountingBackfillResolution", sourceId: issue.id });
    expect(await db.listInventoryCountLines(count.id, business.id)).toEqual(beforeLines);
    expect(await db.countAccountingBackfillIssues(run.id, business.id)).toBe(0);
    const cash = await db.findAccountingAccountByCode(business.id, "1400");
    const adjustment = await db.findAccountingAccountByCode(business.id, "6000");
    const lines = (await db.findJournalEntryBySource(business.id, "AccountingBackfillResolution", issue.id, issue.reason))!.lines;
    expect(lines.reduce((sum, line) => sum + (line.accountId === cash?.id ? line.debitMinor : 0), 0)).toBe(250);
    expect(lines.reduce((sum, line) => sum + (line.accountId === adjustment?.id ? line.debitMinor : 0), 0)).toBe(350);
  });
});

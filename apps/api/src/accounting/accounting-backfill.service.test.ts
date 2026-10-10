import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { AccountingBackfillService } from "./accounting-backfill.service";

describe("AccountingBackfillService cutover date", () => {
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

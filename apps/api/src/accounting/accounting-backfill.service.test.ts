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
});

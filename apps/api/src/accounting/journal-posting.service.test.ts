import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { JournalPostingService } from "./journal-posting.service";

describe("JournalPostingService", () => {
  it("seeds the default chart idempotently and posts each source event once", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Journal", currency: "PHP" });
    const service = new JournalPostingService(db);
    const firstChart = await service.seedChart(business.id);
    const secondChart = await service.seedChart(business.id);
    expect(secondChart).toHaveLength(firstChart.length);

    const input = {
      businessId: business.id, branchId: null, sourceType: "Sale", sourceId: "s1", sourceEvent: "completed",
      draft: { effectiveAt: new Date("2026-10-10T12:00:00Z"), currency: "PHP", description: "Sale", lines: [
        { accountCode: "1000", debitMinor: 300, creditMinor: 0 }, { accountCode: "4000", debitMinor: 0, creditMinor: 300 },
      ] }, actorId: "owner", requestId: "request-1",
    };
    const posted = await service.postSourceEvent(input);
    const replay = await service.postSourceEvent(input);
    expect(replay.entry.id).toBe(posted.entry.id);
    await expect(service.postSourceEvent({ ...input, draft: { ...input.draft, lines: [{ accountCode: "1000", debitMinor: 301, creditMinor: 0 }, { accountCode: "4000", debitMinor: 0, creditMinor: 301 }] } })).rejects.toThrow("IDEMPOTENCY_MISMATCH");
  });

  it("reverses with a new immutable balanced entry and refuses cross-business reads", async () => {
    const db = createMemoryDb();
    const a = await db.createBusiness({ name: "A", currency: "PHP" });
    const b = await db.createBusiness({ name: "B", currency: "PHP" });
    const service = new JournalPostingService(db);
    await service.seedChart(a.id);
    const posted = await service.postSourceEvent({
      businessId: a.id, branchId: null, sourceType: "Expense", sourceId: "e1", sourceEvent: "posted",
      draft: { effectiveAt: new Date("2026-10-10T12:00:00Z"), currency: "PHP", description: "Expense", lines: [
        { accountCode: "6000", debitMinor: 80, creditMinor: 0 }, { accountCode: "1000", debitMinor: 0, creditMinor: 80 },
      ] }, actorId: "owner", requestId: "request-2",
    });
    const reversal = await service.reverse(posted.entry.id, a.id, "owner", "request-3", new Date("2026-10-11T12:00:00Z"));
    expect(reversal.entry.reversesEntryId).toBe(posted.entry.id);
    expect(reversal.lines.map((line) => [line.debitMinor, line.creditMinor])).toEqual([[0, 80], [80, 0]]);
    expect((await service.reverse(posted.entry.id, a.id, "owner", "request-4")).entry.id).toBe(reversal.entry.id);
    await expect(service.reverse(posted.entry.id, b.id, "owner", "request-5")).rejects.toThrow("NOT_FOUND");
  });

  it("audits custom account changes and prevents deactivation after use", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Accounts", currency: "PHP" });
    const service = new JournalPostingService(db);
    await service.seedChart(business.id);
    const expense = await service.createAccount({ businessId: business.id, code: "6001", name: "Rent", type: "expense", normalSide: "debit", actorId: "owner", requestId: "r1" });
    expect(db.audit).toHaveLength(1);
    const renamed = await service.updateAccount({ businessId: business.id, accountId: expense.id, name: "Store rent", actorId: "owner", requestId: "r2" });
    expect(renamed.name).toBe("Store rent");
    await service.postSourceEvent({
      businessId: business.id, branchId: null, sourceType: "Expense", sourceId: "expense-1", sourceEvent: "posted",
      draft: { effectiveAt: new Date("2026-10-10T12:00:00Z"), currency: "PHP", description: "Rent", lines: [
        { accountCode: "6001", debitMinor: 50, creditMinor: 0 }, { accountCode: "1000", debitMinor: 0, creditMinor: 50 },
      ] }, actorId: "owner", requestId: "r3",
    });
    await expect(service.updateAccount({ businessId: business.id, accountId: expense.id, isActive: false, actorId: "owner", requestId: "r4" })).rejects.toThrow("ACCOUNTING_ACCOUNT_IN_USE");
    expect(db.audit).toHaveLength(2);
  });
});

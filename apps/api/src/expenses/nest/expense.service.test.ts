import { describe, expect, it } from "vitest";
import type { DbPort } from "../../common/db.port";
import { createMemoryDb } from "../../common/memory.db";
import { ShiftService } from "../../shifts/nest/shift.service";
import { ExpenseService } from "./expense.service";

describe("phase6 expense port", () => {
  it("round-trips an expense scoped to its business", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense", currency: "PHP" });
    const other = await db.createBusiness({ name: "Other", currency: "PHP" });
    const e = await db.createExpense({
      businessId: business.id, category: "Ice", amountMinor: 500, description: null,
      method: "cash", shiftId: null, expenseDate: new Date("2026-09-20T00:00:00.000Z"),
      actorId: "u1", requestId: "r1", attachmentUrl: null,
      voidedAt: null, voidReason: null, cashAdjusted: true,
    });
    expect(await db.findExpenseById(e.id, business.id)).not.toBeNull();
    expect(await db.findExpenseById(e.id, other.id)).toBeNull();
    expect(await db.listExpensesByBusiness(other.id)).toEqual([]);
  });
});

describe("phase6 expense service", () => {
  it("rolls back an expense when its journal entry cannot post", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense rollback", currency: "PHP" });
    const failingDb: DbPort = {
      ...db,
      async withTransaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
        return db.withTransaction((tx) => fn({ ...tx, async createJournalEntry() { throw new Error("INJECTED_JOURNAL_FAILURE"); } }));
      },
    };
    await expect(new ExpenseService(failingDb).createExpense(business.id, "owner", "expense-fail", { category: "Ice", amountMinor: 500, method: "cash" })).rejects.toThrow("INJECTED_JOURNAL_FAILURE");
    expect(await db.listExpensesByBusiness(business.id)).toHaveLength(0);
    expect(await db.listJournalEntries(business.id, { limit: 10 })).toHaveLength(0);
  });

  it("records a shift-linked cash expense with a paid_out movement", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense", currency: "PHP" });
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister(business.id, "u1", "r0", { name: "Counter 1" }, "owner");
    await shifts.openShift(business.id, "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense(business.id, "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: (await db.findOpenShiftByRegister(business.id, reg.id))!.id,
    });
    expect(e.shiftId).not.toBeNull();
    const moves = await db.listCashMovementsByShift(e.shiftId!, business.id);
    expect(moves.some((m) => m.type === "paid_out" && m.referenceId === e.id)).toBe(true);
    const entries = await db.listJournalEntries(business.id, { limit: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sourceType: "Expense", sourceId: e.id, sourceEvent: "posted" });
    const lines = await db.listJournalLines(entries[0]!.id, business.id);
    expect(lines.reduce((sum, line) => sum + line.debitMinor, 0)).toBe(500);
    expect(lines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(500);
  });
  it("voids with an offsetting adjustment when a shift is open", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense", currency: "PHP" });
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister(business.id, "u1", "r0", { name: "Counter 1" }, "owner");
    const open = await shifts.openShift(business.id, "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense(business.id, "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: open.id,
    });
    const out = await svc.voidExpense(business.id, "u1", "r3", e.id, "duplicate entry", "owner");
    expect(out.cashAdjusted).toBe(true);
    expect((await db.findExpenseById(e.id, business.id))!.voidedAt).not.toBeNull();
    const entries = await db.listJournalEntries(business.id, { limit: 10 });
    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.reversesEntryId === entries.find((candidate) => candidate.sourceType === "Expense")?.id)).toBe(true);
  });
  it("flags cashAdjusted false when no shift is open at void time", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense", currency: "PHP" });
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister(business.id, "u1", "r0", { name: "Counter 1" }, "owner");
    const open = await shifts.openShift(business.id, "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense(business.id, "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: open.id,
    });
    await shifts.closeShift(business.id, "u1", "r3", open.id, { countedCashMinor: 0 }, []);
    const out = await svc.voidExpense(business.id, "u1", "r4", e.id, "duplicate entry", "owner");
    expect(out.cashAdjusted).toBe(false);
  });
  it("rejects cashier voids and bad dates", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense", currency: "PHP" });
    const svc = new ExpenseService(db);
    const e = await svc.createExpense(business.id, "u1", "r1", { category: "Ice", amountMinor: 500, method: "cash" });
    await expect(svc.voidExpense(business.id, "u9", "r2", e.id, "oops", "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(
      svc.createExpense(business.id, "u1", "r3", { category: "Ice", amountMinor: 100, method: "cash", expenseDate: "2030-01-01T00:00:00.000Z" }),
    ).rejects.toThrow("VALIDATION");
  });

  it("serializes a shift-linked cash expense with shift close", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense", currency: "PHP" });
    const setupShifts = new ShiftService(db);
    const reg = await setupShifts.createRegister(business.id, "u1", "r0", { name: "Counter race" }, "owner");
    const open = await setupShifts.openShift(business.id, "u1", "r1", reg.id, { openingFloatMinor: 1000 }, "cashier");

    let reachedSecondFind!: () => void;
    const secondFindReached = new Promise<void>((resolve) => { reachedSecondFind = resolve; });
    let releaseSecondFind!: () => void;
    const secondFindGate = new Promise<void>((resolve) => { releaseSecondFind = resolve; });
    let findCount = 0;
    const delayedDb: DbPort = {
      ...db,
      async findShiftById(id, businessId) {
        findCount += 1;
        if (findCount === 2) {
          reachedSecondFind();
          await secondFindGate;
        }
        return db.findShiftById(id, businessId);
      },
    };
    const expenses = new ExpenseService(delayedDb);
    const shifts = new ShiftService(delayedDb);

    const expensePromise = expenses.createExpense(business.id, "u1", "r-expense", {
      category: "Ice",
      amountMinor: 500,
      method: "cash",
      shiftId: open.id,
    });
    await secondFindReached;
    const closePromise = shifts.closeShift(business.id, "u1", "r-close", open.id, { countedCashMinor: 500 }, []);
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseSecondFind();

    await Promise.all([expensePromise, closePromise]);
    await expect(shifts.getShift(business.id, open.id, "owner", "u1")).resolves.toMatchObject({
      shift: { status: "CLOSED" },
    });
  });

  it("serializes a cash-expense void adjustment with shift close", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense", currency: "PHP" });
    const setupShifts = new ShiftService(db);
    const reg = await setupShifts.createRegister(business.id, "u1", "r0", { name: "Counter void race" }, "owner");
    const open = await setupShifts.openShift(business.id, "u1", "r1", reg.id, { openingFloatMinor: 1000 }, "cashier");
    const setupExpenses = new ExpenseService(db);
    const expense = await setupExpenses.createExpense(business.id, "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: open.id,
    });

    let adjustmentReached!: () => void;
    const reachedAdjustment = new Promise<void>((resolve) => { adjustmentReached = resolve; });
    let releaseAdjustment!: () => void;
    const adjustmentGate = new Promise<void>((resolve) => { releaseAdjustment = resolve; });
    const delayedDb: DbPort = {
      ...db,
      async createCashMovement(input) {
        if (input.type === "adjustment" && input.referenceId === expense.id) {
          adjustmentReached();
          await adjustmentGate;
        }
        return db.createCashMovement(input);
      },
    };
    const expenses = new ExpenseService(delayedDb);
    const shifts = new ShiftService(delayedDb);

    const voidPromise = expenses.voidExpense(business.id, "u1", "r-void", expense.id, "duplicate", "owner");
    await reachedAdjustment;
    const closePromise = shifts.closeShift(business.id, "u1", "r-close", open.id, { countedCashMinor: 1000 }, []);
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseAdjustment();

    await Promise.all([voidPromise, closePromise]);
    await expect(shifts.getShift(business.id, open.id, "owner", "u1")).resolves.toMatchObject({
      shift: { status: "CLOSED" },
    });
  });
});

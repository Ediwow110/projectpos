import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ShiftService } from "../../shifts/nest/shift.service";
import { ExpenseService } from "./expense.service";

describe("phase6 expense port", () => {
  it("round-trips an expense scoped to its business", async () => {
    const db = createMemoryDb();
    const e = await db.createExpense({
      businessId: "b1", category: "Ice", amountMinor: 500, description: null,
      method: "cash", shiftId: null, expenseDate: new Date("2026-09-20T00:00:00.000Z"),
      actorId: "u1", requestId: "r1", attachmentUrl: null,
      voidedAt: null, voidReason: null, cashAdjusted: true,
    });
    expect(await db.findExpenseById(e.id, "b1")).not.toBeNull();
    expect(await db.findExpenseById(e.id, "b2")).toBeNull();
    expect(await db.listExpensesByBusiness("b2")).toEqual([]);
  });
});

describe("phase6 expense service", () => {
  it("records a shift-linked cash expense with a paid_out movement", async () => {
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense("b1", "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: (await db.findOpenShiftByRegister("b1", reg.id))!.id,
    });
    expect(e.shiftId).not.toBeNull();
    const moves = await db.listCashMovementsByShift(e.shiftId!, "b1");
    expect(moves.some((m) => m.type === "paid_out" && m.referenceId === e.id)).toBe(true);
  });
  it("voids with an offsetting adjustment when a shift is open", async () => {
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    const open = await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense("b1", "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: open.id,
    });
    const out = await svc.voidExpense("b1", "u1", "r3", e.id, "duplicate entry", "owner");
    expect(out.cashAdjusted).toBe(true);
    expect((await db.findExpenseById(e.id, "b1"))!.voidedAt).not.toBeNull();
  });
  it("flags cashAdjusted false when no shift is open at void time", async () => {
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    const open = await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
    const svc = new ExpenseService(db);
    const e = await svc.createExpense("b1", "u1", "r2", {
      category: "Ice", amountMinor: 500, method: "cash", shiftId: open.id,
    });
    await shifts.closeShift("b1", "u1", "r3", open.id, { countedCashMinor: 0 }, []);
    const out = await svc.voidExpense("b1", "u1", "r4", e.id, "duplicate entry", "owner");
    expect(out.cashAdjusted).toBe(false);
  });
  it("rejects cashier voids and bad dates", async () => {
    const db = createMemoryDb();
    const svc = new ExpenseService(db);
    const e = await svc.createExpense("b1", "u1", "r1", { category: "Ice", amountMinor: 500, method: "cash" });
    await expect(svc.voidExpense("b1", "u9", "r2", e.id, "oops", "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(
      svc.createExpense("b1", "u1", "r3", { category: "Ice", amountMinor: 100, method: "cash", expenseDate: "2030-01-01T00:00:00.000Z" }),
    ).rejects.toThrow("VALIDATION");
  });
});

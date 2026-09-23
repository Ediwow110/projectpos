import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase5 shift port", () => {
  it("round-trips a register scoped to its business", async () => {
    const db = createMemoryDb();
    const reg = await db.createRegister({ businessId: "b1", name: "Counter 1", isActive: true });
    expect((await db.listRegisters("b1")).map((r) => r.id)).toContain(reg.id);
    expect(await db.listRegisters("b2")).toEqual([]);
    expect(await db.findRegisterById(reg.id, "b2")).toBeNull();
  });
  it("tracks one open shift per register", async () => {
    const db = createMemoryDb();
    const reg = await db.createRegister({ businessId: "b1", name: "Counter 1", isActive: true });
    expect(await db.findOpenShiftByRegister("b1", reg.id)).toBeNull();
    const shift = await db.createShift({
      businessId: "b1", registerId: reg.id, status: "OPEN",
      openedBy: "u1", closedBy: null, openingFloatMinor: 5000,
      countedCashMinor: null, varianceMinor: null,
      cashSalesMinor: 0, cashRefundsMinor: 0, cashExpensesMinor: 0,
      cashDepositsMinor: 0, cashWithdrawalsMinor: 0, adjustmentsMinor: 0,
      expectedCashMinor: 0, closeNotes: null,
    });
    expect((await db.findOpenShiftByRegister("b1", reg.id))!.id).toBe(shift.id);
    expect(await db.findOpenShiftByRegister("b2", reg.id)).toBeNull();
  });
  it("scopes cash movements to their shift", async () => {
    const db = createMemoryDb();
    const reg = await db.createRegister({ businessId: "b1", name: "Counter 1", isActive: true });
    const shift = await db.createShift({
      businessId: "b1", registerId: reg.id, status: "OPEN",
      openedBy: "u1", closedBy: null, openingFloatMinor: 0,
      countedCashMinor: null, varianceMinor: null,
      cashSalesMinor: 0, cashRefundsMinor: 0, cashExpensesMinor: 0,
      cashDepositsMinor: 0, cashWithdrawalsMinor: 0, adjustmentsMinor: 0,
      expectedCashMinor: 0, closeNotes: null,
    });
    await db.createCashMovement({
      businessId: "b1", shiftId: shift.id, registerId: reg.id, type: "cash_sale",
      amountMinor: 2500, reason: null, referenceType: "Sale", referenceId: "s1",
      actorId: "u1", requestId: "r1",
    });
    expect((await db.listCashMovementsByShift(shift.id, "b1")).length).toBe(1);
    expect(await db.listCashMovementsByShift(shift.id, "b2")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ShiftService } from "./shift.service";

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

async function setupShift() {
  const db = createMemoryDb();
  const svc = new ShiftService(db);
  const reg = await svc.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
  return { db, svc, registerId: reg.id };
}

describe("phase5 shift service", () => {
  it("opens with float, records cash, closes with reconciled variance", async () => {
    const { db, svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 10000 }, "cashier");
    expect(shift.status).toBe("OPEN");
    await svc.recordCash("b1", "u1", "r2", shift.id, { kind: "paid_out", amountMinor: 1200, reason: "ice delivery" }, []);
    await svc.recordCash("b1", "u1", "r3", shift.id, { kind: "cash_deposit", amountMinor: 2000 }, []);
    const { shift: closed, report } = await svc.closeShift("b1", "u1", "r4", shift.id, { countedCashMinor: 10800 }, []);
    expect(closed.status).toBe("CLOSED");
    expect(report.expectedCash).toBe(10800);
    expect(report.variance).toBe(0);
    expect((await db.listAudit()).map((a) => a.action)).toEqual(
      expect.arrayContaining(["shift.open", "shift.cash", "shift.close"]),
    );
  });
  it("rejects double open and double close", async () => {
    const { svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await expect(svc.openShift("b1", "u1", "r2", registerId, { openingFloatMinor: 0 }, "cashier")).rejects.toThrow("SHIFT_ALREADY_OPEN");
    await svc.closeShift("b1", "u1", "r3", shift.id, { countedCashMinor: 0 }, []);
    await expect(svc.closeShift("b1", "u1", "r4", shift.id, { countedCashMinor: 0 }, [])).rejects.toThrow("SHIFT_ALREADY_CLOSED");
  });
  it("rejects mutations on a closed shift", async () => {
    const { svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await svc.closeShift("b1", "u1", "r2", shift.id, { countedCashMinor: 0 }, []);
    await expect(
      svc.recordCash("b1", "u1", "r3", shift.id, { kind: "cash_deposit", amountMinor: 100 }, []),
    ).rejects.toThrow("SHIFT_CLOSED_IMMUTABLE");
  });
  it("requires override to close another actor's shift", async () => {
    const { svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await expect(svc.closeShift("b1", "u2", "r2", shift.id, { countedCashMinor: 0 }, [])).rejects.toThrow("FORBIDDEN");
    await svc.closeShift("b1", "u2", "r2", shift.id, { countedCashMinor: 0 }, ["shift.close.override"]);
  });
  it("blocks cashier register setup and cross-tenant reads", async () => {
    const { svc, registerId } = await setupShift();
    await expect(svc.createRegister("b1", "u9", "r9", { name: "Back" }, "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(svc.getShift("b2", "nope", "owner", "u1")).rejects.toThrow("NOT_FOUND");
    void registerId;
  });
});

describe("phase11 post-close corrections", () => {
  it("records an audited correction on a closed shift and surfaces it in the report", async () => {
    const { db, svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 10000 }, "cashier");
    const closed = await svc.closeShift("b1", "u1", "r3", shift.id, { countedCashMinor: 10000 }, []);
    await expect(
      svc.addCorrection("b1", "u1", "r4", ["shift.close.override"], closed.shift.id, { amountMinor: 0, reason: "nothing" }),
    ).rejects.toThrow("VALIDATION");
    await expect(
      svc.addCorrection("b1", "u1", "r4", [], closed.shift.id, { amountMinor: -500, reason: "counted before last drop" }),
    ).rejects.toThrow("FORBIDDEN");
    const correction = await svc.addCorrection("b1", "u1", "r5", ["shift.close.override"], closed.shift.id, {
      amountMinor: -500, reason: "counted before last drop",
    });
    expect(correction.amountMinor).toBe(-500);
    // The closed shift itself is untouched (FR-CASH-04).
    expect((await db.findShiftById(closed.shift.id, "b1"))!.expectedCashMinor).toBe(closed.shift.expectedCashMinor);
    const report = await svc.getShift("b1", closed.shift.id, "owner", "u1");
    expect(report.corrections).toHaveLength(1);
    expect(report.correctedExpectedCash).toBe(closed.report.expectedCash - 500);
    expect((await db.listAudit()).some((a) => a.action === "shift.corrected")).toBe(true);
  });

  it("refuses corrections on an open shift", async () => {
    const { svc, registerId } = await setupShift();
    const shift = await svc.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await expect(
      svc.addCorrection("b1", "u1", "r2", ["shift.close.override"], shift.id, { amountMinor: 100, reason: "too early" }),
    ).rejects.toThrow("VALIDATION");
  });
});

import { describe, expect, it } from "vitest";
import { computeExpectedCash, computeVariance } from "../apps/api/src/shifts/cash";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { ShiftService } from "../apps/api/src/shifts/nest/shift.service";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";

async function setup() {
  const db = createMemoryDb();
  const shifts = new ShiftService(db);
  const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 20 });
  return { db, shifts, svc: new SalesService(db), registerId: reg.id, productId: prod.id };
}

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

describe("phase5 exit", () => {
  it("opening-to-closing cash reconciles from immutable movements", async () => {
    const { db, shifts, svc, registerId, productId } = await setup();
    const shift = await shifts.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 10000 }, "cashier");
    const draft = await svc.createDraft("b1", "u1", "r2", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId,
    }, ALL);
    await svc.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "exit5-1", granted: ALL,
    });
    await shifts.recordCash("b1", "u1", "r4", shift.id, { kind: "paid_out", amountMinor: 1200, reason: "ice" }, []);
    const { report } = await shifts.closeShift("b1", "u1", "r5", shift.id, { countedCashMinor: 13800 }, []);
    expect(report.expectedCash).toBe(10000 + 5000 - 1200);
    expect(report.variance).toBe(0);
    expect(computeExpectedCash({ ...report.components, openingFloat: 10000 })).toBe(report.expectedCash);
    expect(computeVariance(13800, report.expectedCash)).toBe(0);
    expect((await db.listCashMovementsByShift(shift.id, "b1")).length).toBe(3);
  });
  it("closed shifts reject mutations and double close", async () => {
    const { shifts, registerId } = await setup();
    const shift = await shifts.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await shifts.closeShift("b1", "u1", "r2", shift.id, { countedCashMinor: 0 }, []);
    await expect(shifts.recordCash("b1", "u1", "r3", shift.id, { kind: "cash_deposit", amountMinor: 100 }, [])).rejects.toThrow("SHIFT_CLOSED_IMMUTABLE");
    await expect(shifts.closeShift("b1", "u1", "r4", shift.id, { countedCashMinor: 0 }, [])).rejects.toThrow("SHIFT_ALREADY_CLOSED");
  });
  it("one open shift per register; cross-tenant blocked", async () => {
    const { shifts, registerId } = await setup();
    await shifts.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await expect(shifts.openShift("b1", "u1", "r2", registerId, { openingFloatMinor: 0 }, "cashier")).rejects.toThrow("SHIFT_ALREADY_OPEN");
    await expect(shifts.getShift("b2", "nope", "owner", "u1")).rejects.toThrow("NOT_FOUND");
  });
  it("replayed sales post no second cash movement", async () => {
    const { db, shifts, svc, registerId, productId } = await setup();
    await shifts.openShift("b1", "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    const draft = await svc.createDraft("b1", "u1", "r2", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId,
    }, ALL);
    const payload = { payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit5-r", granted: ALL };
    await svc.completeSale("b1", "u1", "r3", draft.id, payload);
    await svc.completeSale("b1", "u1", "r4", draft.id, payload);
    const open = (await db.findOpenShiftByRegister("b1", registerId))!;
    expect((await db.listCashMovementsByShift(open.id, "b1")).filter((m) => m.type === "cash_sale").length).toBe(1);
  });
});

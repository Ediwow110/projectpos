import { describe, expect, it } from "vitest";
import { computeExpectedCash, computeVariance } from "../apps/api/src/shifts/cash";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { ShiftService } from "../apps/api/src/shifts/nest/shift.service";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";

async function setup() {
  const db = createMemoryDb();
  const businessId = (await db.createBusiness({ name: "Phase 5", currency: "PHP" })).id;
  const shifts = new ShiftService(db);
  const reg = await shifts.createRegister(businessId, "u1", "r0", { name: "Counter 1" }, "owner");
  const prod = await db.createProduct({
    businessId, categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId, productId: prod.id, qtyOnHand: 20 });
  return { db, shifts, svc: new SalesService(db), businessId, registerId: reg.id, productId: prod.id };
}

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

describe("phase5 exit", () => {
  it("opening-to-closing cash reconciles from immutable movements", async () => {
    const { db, shifts, svc, businessId, registerId, productId } = await setup();
    const shift = await shifts.openShift(businessId, "u1", "r1", registerId, { openingFloatMinor: 10000 }, "cashier");
    const draft = await svc.createDraft(businessId, "u1", "r2", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId,
    }, ALL);
    await svc.completeSale(businessId, "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "exit5-1", granted: ALL,
    });
    await shifts.recordCash(businessId, "u1", "r4", shift.id, { kind: "paid_out", amountMinor: 1200, reason: "ice" }, []);
    const { report } = await shifts.closeShift(businessId, "u1", "r5", shift.id, { countedCashMinor: 13800 }, []);
    expect(report.expectedCash).toBe(10000 + 5000 - 1200);
    expect(report.variance).toBe(0);
    expect(computeExpectedCash({ ...report.components, openingFloat: 10000 })).toBe(report.expectedCash);
    expect(computeVariance(13800, report.expectedCash)).toBe(0);
    expect((await db.listCashMovementsByShift(shift.id, businessId)).length).toBe(3);
  });
  it("closed shifts reject mutations and double close", async () => {
    const { shifts, businessId, registerId } = await setup();
    const shift = await shifts.openShift(businessId, "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await shifts.closeShift(businessId, "u1", "r2", shift.id, { countedCashMinor: 0 }, []);
    await expect(shifts.recordCash(businessId, "u1", "r3", shift.id, { kind: "cash_deposit", amountMinor: 100 }, [])).rejects.toThrow("SHIFT_CLOSED_IMMUTABLE");
    await expect(shifts.closeShift(businessId, "u1", "r4", shift.id, { countedCashMinor: 0 }, [])).rejects.toThrow("SHIFT_ALREADY_CLOSED");
  });
  it("one open shift per register; cross-tenant blocked", async () => {
    const { shifts, businessId, registerId } = await setup();
    await shifts.openShift(businessId, "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    await expect(shifts.openShift(businessId, "u1", "r2", registerId, { openingFloatMinor: 0 }, "cashier")).rejects.toThrow("SHIFT_ALREADY_OPEN");
    await expect(shifts.getShift("missing-business", "nope", "owner", "u1")).rejects.toThrow("NOT_FOUND");
  });
  it("replayed sales post no second cash movement", async () => {
    const { db, shifts, svc, businessId, registerId, productId } = await setup();
    await shifts.openShift(businessId, "u1", "r1", registerId, { openingFloatMinor: 0 }, "cashier");
    const draft = await svc.createDraft(businessId, "u1", "r2", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId,
    }, ALL);
    const payload = { payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit5-r", granted: ALL };
    await svc.completeSale(businessId, "u1", "r3", draft.id, payload);
    await svc.completeSale(businessId, "u1", "r4", draft.id, payload);
    const open = (await db.findOpenShiftByRegister(businessId, registerId))!;
    expect((await db.listCashMovementsByShift(open.id, businessId)).filter((m) => m.type === "cash_sale").length).toBe(1);
  });
});

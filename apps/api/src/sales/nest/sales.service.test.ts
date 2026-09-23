import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { SalesService } from "./sales.service";

describe("phase4 sales port", () => {
  it("round-trips a sale scoped to its business", async () => {
    const db = createMemoryDb();
    const sale = await db.createSale({
      businessId: "b1", receiptNo: "2026-000001", status: "DRAFT",
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0,
      paidMinor: 0, changeMinor: 0, currency: "PHP",
      customerId: null, customerName: null, notes: null,
      actorId: "u1", requestId: "r1", idempotencyKey: null, registerId: null, createdAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    expect(await db.findSaleById(sale.id, "b1")).not.toBeNull();
    expect(await db.findSaleById(sale.id, "b2")).toBeNull();
    expect(await db.listSalesByBusiness("b2")).toEqual([]);
  });
  it("claims idempotency keys once per command type", async () => {
    const db = createMemoryDb();
    await db.claimIdempotency({
      businessId: "b1", key: "k1", commandType: "sale.complete",
      fingerprint: "fp1", resultId: "s1",
    });
    await expect(
      db.claimIdempotency({
        businessId: "b1", key: "k1", commandType: "sale.complete",
        fingerprint: "fp1", resultId: "s1",
      }),
    ).rejects.toThrow("IDEMPOTENCY_REPLAY");
    expect(await db.findIdempotency("b1", "k1", "sale.complete")).not.toBeNull();
  });
  it("issues sequential receipt numbers per business", async () => {
    const db = createMemoryDb();
    const first = await db.nextReceiptNo("b1");
    const second = await db.nextReceiptNo("b1");
    expect(first).not.toBe(second);
    expect(await db.nextReceiptNo("b2")).toBe(first);
  });
});

async function setupSale() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
  const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view", "price.edit"];
  return { db, svc: new SalesService(db), productId: prod.id, ALL };
}

describe("phase4 sales service", () => {
  it("drafts and completes a sale with stock decrease and audit", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    expect(draft.status).toBe("DRAFT");
    const done = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "key-00001", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(8);
    expect((await db.listAudit()).some((a) => a.action === "sale.complete")).toBe(true);
  });
  it("replays the same idempotency key without a second sale", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const first = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "key-replay", granted: ALL,
    });
    const second = await svc.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "key-replay", granted: ALL,
    });
    expect(second.replayed).toBe(true);
    expect(second.sale.id).toBe(first.sale.id);
    expect((await db.listSalesByBusiness("b1")).filter((s) => s.status === "COMPLETED").length).toBe(1);
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(9);
  });
  it("rejects oversell with INSUFFICIENT_STOCK and writes nothing", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 99, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    await expect(
      svc.completeSale("b1", "u1", "r2", draft.id, {
        payments: [{ method: "cash", amountMinor: draft.totalMinor }],
        key: "key-oversell", granted: ALL,
      }),
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    expect((await db.listMovements(productId, "b1")).length).toBe(0);
  });
  it("rejects over-threshold discount without override", async () => {
    const { svc, productId } = await setupSale();
    await expect(
      svc.createDraft("b1", "u1", "r1", {
        lines: [{ productId, qty: 1, lineDiscountMinor: 0 }],
        orderDiscountMinor: 1000,
      }, []),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("blocks cross-tenant sale reads with NOT_FOUND", async () => {
    const { svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    await expect(svc.getSale("b2", draft.id, ALL)).rejects.toThrow("NOT_FOUND");
  });
});

describe("phase5 cash auto-post", () => {
  it("posts a cash_sale movement when registerId is present", async () => {
    const { createMemoryDb } = await import("../../common/memory.db");
    const { ShiftService } = await import("../../shifts/nest/shift.service");
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
    const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];
    const svc = new SalesService(db);
    await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 10000 }, "cashier");
    const draft = await svc.createDraft("b1", "u1", "r2", {
      lines: [{ productId: prod.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: reg.id,
    }, ALL);
    const done = await svc.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "cash-post-1", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    const openId = (await db.findOpenShiftByRegister("b1", reg.id))!.id;
    expect((await db.listCashMovementsByShift(openId, "b1")).filter((m) => m.type === "cash_sale").length).toBe(1);
    const replay = await svc.completeSale("b1", "u1", "r4", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "cash-post-1", granted: ALL,
    });
    expect(replay.replayed).toBe(true);
    expect(
      (await db.listCashMovementsByShift((await db.findOpenShiftByRegister("b1", reg.id))!.id, "b1"))
        .filter((m) => m.type === "cash_sale").length,
    ).toBe(1);
  });
  it("rejects cash sales with no open shift and writes nothing", async () => {
    const { createMemoryDb } = await import("../../common/memory.db");
    const { ShiftService } = await import("../../shifts/nest/shift.service");
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
    const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];
    const svc = new SalesService(db);
    const draft = await svc.createDraft("b1", "u1", "r2", {
      lines: [{ productId: prod.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: reg.id,
    }, ALL);
    await expect(
      svc.completeSale("b1", "u1", "r3", draft.id, {
        payments: [{ method: "cash", amountMinor: draft.totalMinor }],
        key: "cash-post-2", granted: ALL,
      }),
    ).rejects.toThrow("SHIFT_NO_OPEN_SHIFT");
    expect((await db.listMovements(prod.id, "b1")).length).toBe(0);
  });
});

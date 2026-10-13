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
  it("filters sales by assigned branch before pagination", async () => {
    const db = createMemoryDb();
    const service = new SalesService(db);
    for (const [receiptNo, branchId] of [
      ["2026-000001", "north"],
      ["2026-000002", "south"],
      ["2026-000003", "north"],
    ] as const) {
      await db.createSale({
        businessId: "b1", receiptNo, status: "DRAFT",
        subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0,
        paidMinor: 0, changeMinor: 0, currency: "PHP",
        customerId: null, customerName: null, notes: null,
        actorId: "cashier", requestId: "scope-test", idempotencyKey: null,
        registerId: null, branchId, createdAt: new Date(),
      });
    }
    const page = await service.listSales("b1", { limit: 1, branchId: "north" });
    expect(page.items.map((sale) => sale.receiptNo)).toEqual(["2026-000003"]);
    expect(page.nextCursor).not.toBeNull();
    const second = await service.listSales("b1", { limit: 1, branchId: "north", cursor: page.nextCursor! });
    expect(second.items.map((sale) => sale.receiptNo)).toEqual(["2026-000001"]);
    expect(second.nextCursor).toBeNull();
    expect((await service.listSales("b1", { limit: 10 })).items).toHaveLength(3);
  });
  it("enforces configured owner discount limits for a staff role without override grant", async () => {
    const { db, svc, productId } = await setupSale();
    const input = { lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 250 };
    // Existing default rule (10%) allows a discount exactly at the boundary.
    await expect(svc.createDraft("b1", "cashier", "discount-default", input, [])).resolves.toBeTruthy();
    await db.saveSettings("b1", { orderDiscountApprovalPercent: 5, lineDiscountApprovalPercent: 5 });
    await expect(svc.createDraft("b1", "cashier", "discount-restricted", input, []))
      .rejects.toThrow("FORBIDDEN");
    await expect(svc.createDraft("b1", "manager", "discount-approved", input, ["discount.override"]))
      .resolves.toBeTruthy();
  });
  it("creates one POS Order companion with every new POS draft", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r-pos-order", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const order = await db.findOrderBySaleId(draft.id, "b1");
    expect(order).toMatchObject({
      channel: "POS", fulfillmentMode: "NONE", paymentMode: "POS", status: "CONFIRMED", saleId: draft.id,
    });
    expect((await db.listOrderLines(order!.id, "b1"))).toHaveLength(1);
  });

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
    expect(await db.findOrderBySaleId(draft.id, "b1")).toMatchObject({ status: "COMPLETED" });
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(8);
    expect((await db.listAudit()).some((a) => a.action === "sale.complete")).toBe(true);
  });
  it("persists the trimmed void reason and timestamp on the sale projection", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);

    const voided = await svc.voidSale("b1", "u1", "r-void", draft.id, "  Duplicate draft  ", ALL);

    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("Duplicate draft");
    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect((await db.findSaleById(draft.id, "b1"))?.voidReason).toBe("Duplicate draft");
    expect(await db.findOrderBySaleId(draft.id, "b1")).toMatchObject({ status: "CANCELLED" });
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
  it("serializes void with in-flight completion of the same business", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0,
    }, ALL);
    const originalCreateMovement = db.createMovement.bind(db);
    let enteredStockWrite!: () => void;
    let releaseStockWrite!: () => void;
    const stockWriteEntered = new Promise<void>((resolve) => {
      enteredStockWrite = resolve;
    });
    const stockWriteReleased = new Promise<void>((resolve) => {
      releaseStockWrite = resolve;
    });
    db.createMovement = async (input) => {
      if (input.requestId === "r-complete" && input.referenceType === "Sale") {
        enteredStockWrite();
        await stockWriteReleased;
      }
      return originalCreateMovement(input);
    };

    const completing = svc.completeSale("b1", "u1", "r-complete", draft.id, {
      payments: [{ method: "card", amountMinor: draft.totalMinor }],
      key: "complete-vs-void",
      granted: ALL,
    });
    await stockWriteEntered;

    let voidSettled = false;
    const voiding = svc
      .voidSale(
        "b1",
        "u1",
        "r-void",
        draft.id,
        "operator cancel",
        ALL,
      )
      .finally(() => {
        voidSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(voidSettled).toBe(false);

    releaseStockWrite();
    await completing;
    await expect(voiding).rejects.toThrow("SALE_INVALID_TRANSITION");
    expect((await db.findSaleById(draft.id, "b1"))?.status).toBe("COMPLETED");
  });
  it("allows only one concurrent void transition and one audit effect", async () => {
    const { db, svc, productId, ALL } = await setupSale();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const results = await Promise.allSettled([
      svc.voidSale("b1", "u1", "r-void-a", draft.id, "duplicate", ALL),
      svc.voidSale("b1", "u1", "r-void-b", draft.id, "operator cancel", ALL),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected").map((result) => String(result.reason))).toEqual(expect.arrayContaining([expect.stringContaining("SALE_INVALID_TRANSITION")]));
    expect((await db.listAudit()).filter((entry) => entry.action === "sale.void")).toHaveLength(1);
    expect((await db.findSaleById(draft.id, "b1"))?.voidReason).toMatch(/duplicate|operator cancel/);
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
describe("phase9a sale branch scope", () => {
  it("stores branchId from input and deducts branch-keyed stock", async () => {
    const db = createMemoryDb();
    const branch = await db.createBranch({ businessId: "b1", name: "North", type: "store", isActive: true });
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", branchId: branch.id, productId: prod.id, qtyOnHand: 10 });
    const svc = new SalesService(db);
    const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, branchId: branch.id,
    }, ALL);
    expect((draft as { branchId: string | null }).branchId).toBe(branch.id);
    const done = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "br-sale-1", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    expect((await db.findBalance(prod.id, "b1", branch.id))!.qtyOnHand).toBe(8);
    // The branch-keyed deduction must not leak into the legacy null scope.
    expect(await db.findBalance(prod.id, "b1", null)).toBeNull();
  });

  it("deducts the completion-time branch when a draft had no branch yet", async () => {
    const db = createMemoryDb();
    const branch = await db.createBranch({ businessId: "b1", name: "South", type: "store", isActive: true });
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Juice", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 700, priceMinor: 1500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", branchId: branch.id, productId: prod.id, qtyOnHand: 5 });
    const svc = new SalesService(db);
    const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);

    const done = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "card", amountMinor: draft.totalMinor }],
      key: "br-sale-complete-1",
      granted: ALL,
      branchId: branch.id,
    });

    expect(done.sale.status).toBe("COMPLETED");
    expect(done.sale.branchId).toBe(branch.id);
    expect((await db.findBalance(prod.id, "b1", branch.id))!.qtyOnHand).toBe(3);
    expect(await db.findBalance(prod.id, "b1", null)).toBeNull();
  });

  it("rejects a draft branch that disagrees with the selected register branch", async () => {
    const db = createMemoryDb();
    const north = await db.createBranch({ businessId: "b1", name: "North", type: "store", isActive: true });
    const south = await db.createBranch({ businessId: "b1", name: "South", type: "store", isActive: true });
    const register = await db.createRegister({ businessId: "b1", name: "North till", isActive: true, branchId: north.id });
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Tea", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 500, priceMinor: 1200, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    const svc = new SalesService(db);

    await expect(
      svc.createDraft("b1", "u1", "r1", {
        lines: [{ productId: prod.id, qty: 1, lineDiscountMinor: 0 }],
        orderDiscountMinor: 0,
        registerId: register.id,
        branchId: south.id,
      }, ["discount.override"]),
    ).rejects.toThrow("VALIDATION");
  });

  it("rejects a completion branch that disagrees with the selected register branch", async () => {
    const db = createMemoryDb();
    const north = await db.createBranch({ businessId: "b1", name: "North", type: "store", isActive: true });
    const south = await db.createBranch({ businessId: "b1", name: "South", type: "store", isActive: true });
    const register = await db.createRegister({ businessId: "b1", name: "North till", isActive: true, branchId: north.id });
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coffee", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 600, priceMinor: 1400, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", branchId: north.id, productId: prod.id, qtyOnHand: 5 });
    await db.upsertBalance({ businessId: "b1", branchId: south.id, productId: prod.id, qtyOnHand: 5 });
    const svc = new SalesService(db);
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId: prod.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ["discount.override"]);

    await expect(
      svc.completeSale("b1", "u1", "r2", draft.id, {
        payments: [{ method: "card", amountMinor: draft.totalMinor }],
        key: "branch-mismatch-1",
        granted: ["discount.override"],
        registerId: register.id,
        branchId: south.id,
      }),
    ).rejects.toThrow("VALIDATION");
  });
});

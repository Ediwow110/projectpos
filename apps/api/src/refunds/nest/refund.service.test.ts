import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { SalesService } from "../../sales/nest/sales.service";
import { ShiftService } from "../../shifts/nest/shift.service";
import { RefundService } from "./refund.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setupRefund() {
  const db = createMemoryDb();
  const shifts = new ShiftService(db);
  const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
  await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
  const svc = new SalesService(db);
  const draft = await svc.createDraft("b1", "u1", "r2", {
    lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: reg.id,
  }, ALL);
  await svc.completeSale("b1", "u1", "r3", draft.id, {
    payments: [{ method: "cash", amountMinor: draft.totalMinor }],
    key: "refund-setup-1", granted: ALL,
  });
  return { db, svc: new RefundService(db), saleId: draft.id, productId: prod.id };
}

describe("phase6 refund service", () => {
  it("refunds the discounted line amount instead of the pre-discount gross", async () => {
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister("b1", "u1", "r0-discount", { name: "Discount Counter" }, "owner");
    await shifts.openShift("b1", "u1", "r1-discount", reg.id, { openingFloatMinor: 0 }, "cashier");
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Discount Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 10 });
    const sales = new SalesService(db);
    const draft = await sales.createDraft("b1", "u1", "r2-discount", {
      lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 1000 }],
      orderDiscountMinor: 0,
      registerId: reg.id,
    }, ALL);
    await sales.completeSale("b1", "u1", "r3-discount", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "discount-refund-sale",
      granted: ALL,
    });
    const items = await db.listSaleItems(draft.id, "b1");
    const refunds = new RefundService(db);
    const out = await refunds.approveRefund("b1", "u1", "r4-discount", draft.id, {
      items: [{ saleItemId: items[0]!.id, qty: 1 }],
      key: "discount-refund-approve",
    }, ALL, "owner");
    expect(out.refund.totalMinor).toBe(2000);
  });

  it("approves a full refund with all four compensating writes", async () => {
    const { db, svc, saleId, productId } = await setupRefund();
    const items = await db.listSaleItems(saleId, "b1");
    const out = await svc.approveRefund("b1", "u1", "r4", saleId, {
      items: [{ saleItemId: items[0].id, qty: 2 }], key: "ref-approve-1",
    }, ALL, "owner");
    expect(out.sale.status).toBe("REFUNDED");
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(10);
    expect((await db.listPaymentsBySale(saleId, "b1")).some((p) => p.status === "REFUNDED")).toBe(true);
    const open = (await db.findOpenShiftByRegister("b1", (await db.findSaleById(saleId, "b1"))!.registerId!))!;
    expect((await db.listCashMovementsByShift(open.id, "b1")).some((m) => m.type === "cash_refund")).toBe(true);
    const actions = (await db.listAudit()).map((a) => a.action);
    expect(actions).toContain("refund.approve");
  });
  it("keeps sale completion and refund symmetric when the live bundle changes", async () => {
    const db = createMemoryDb();
    const shifts = new ShiftService(db);
    const register = await shifts.createRegister("b1", "u1", "r0-bundle", { name: "Bundle Counter" }, "owner");
    await shifts.openShift("b1", "u1", "r1-bundle", register.id, { openingFloatMinor: 0 }, "cashier");
    const componentA = await db.createProduct({ businessId: "b1", categoryId: null, name: "Bundle A", sku: "BA", barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    const componentB = await db.createProduct({ businessId: "b1", categoryId: null, name: "Bundle B", sku: "BB", barcode: null, brand: null, unit: "pc", costMinor: 150, priceMinor: 300, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    const bundleProduct = await db.createProduct({ businessId: "b1", categoryId: null, name: "Snapshot bundle", sku: "BUNDLE-SNAP", barcode: null, brand: null, unit: "kit", costMinor: 250, priceMinor: 700, taxRateBps: null, reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null, productType: "BUNDLE" });
    const bundle = await db.createProductBundle({ businessId: "b1", bundleProductId: bundleProduct.id, version: 1 });
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: componentA.id, quantity: 1, position: 0 });
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: componentB.id, quantity: 1, position: 1 });
    await db.upsertBalance({ businessId: "b1", productId: componentA.id, qtyOnHand: 10 });
    await db.upsertBalance({ businessId: "b1", productId: componentB.id, qtyOnHand: 10 });
    const sales = new SalesService(db);
    const draft = await sales.createDraft("b1", "u1", "r2-bundle", { lines: [{ productId: bundleProduct.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: register.id }, ALL);
    const items = await db.listSaleItems(draft.id, "b1");
    expect(await db.listSaleItemBundleComponents(items[0]!.id, "b1")).toHaveLength(2);
    await db.deleteBundleComponents(bundle.id, "b1");
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: componentA.id, quantity: 2, position: 0 });
    await db.createBundleComponent({ businessId: "b1", bundleId: bundle.id, componentProductId: componentB.id, quantity: 1, position: 1 });
    await db.updateProductBundle(bundle.id, "b1", { version: 2 });
    await sales.completeSale("b1", "u1", "r3-bundle", draft.id, { payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "bundle-snapshot-sale", granted: ALL });
    expect((await db.findBalance(componentA.id, "b1"))!.qtyOnHand).toBe(9);
    expect((await db.findBalance(componentB.id, "b1"))!.qtyOnHand).toBe(9);
    const refund = new RefundService(db);
    await refund.approveRefund("b1", "u1", "r4-bundle", draft.id, { items: [{ saleItemId: items[0]!.id, qty: 1 }], key: "bundle-snapshot-refund" }, ALL, "owner");
    expect((await db.findBalance(componentA.id, "b1"))!.qtyOnHand).toBe(10);
    expect((await db.findBalance(componentB.id, "b1"))!.qtyOnHand).toBe(10);
  });
  it("rejects over-quantity refunds with nothing written", async () => {
    const { db, svc, saleId } = await setupRefund();
    const items = await db.listSaleItems(saleId, "b1");
    await expect(
      svc.approveRefund("b1", "u1", "r4", saleId, {
        items: [{ saleItemId: items[0].id, qty: 99 }], key: "ref-approve-2",
      }, ALL, "owner"),
    ).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
    expect(await db.listRefundsBySale(saleId, "b1")).toEqual([]);
  });
  it("rejects duplicate line entries whose combined quantity exceeds the refundable amount", async () => {
    const { db, svc, saleId } = await setupRefund();
    const items = await db.listSaleItems(saleId, "b1");
    await expect(svc.approveRefund("b1", "u1", "r-duplicate-lines", saleId, {
      items: [{ saleItemId: items[0].id, qty: 2 }, { saleItemId: items[0].id, qty: 1 }],
      key: "ref-duplicate-lines",
    }, ALL, "owner")).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
    expect(await db.listRefundsBySale(saleId, "b1")).toHaveLength(0);
  });
  it("rejects self-approval by non-owners", async () => {
    const { db, svc, saleId } = await setupRefund();
    const sales = new SalesService(db);
    await sales.requestRefund("b1", "u1", "r4b", saleId, "customer complaint", "req-key-3", ALL);
    const items = await db.listSaleItems(saleId, "b1");
    await expect(
      svc.approveRefund("b1", "u1", "r5", saleId, {
        items: [{ saleItemId: items[0].id, qty: 1 }], key: "ref-approve-3",
      }, ALL, "manager"),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("replays approve keys without duplicate writes", async () => {
    const { db, svc, saleId } = await setupRefund();
    const items = await db.listSaleItems(saleId, "b1");
    const input = { items: [{ saleItemId: items[0].id, qty: 1 }], key: "ref-approve-4" };
    await svc.approveRefund("b1", "u1", "r4", saleId, input, ALL, "owner");
    const again = await svc.approveRefund("b1", "u1", "r5", saleId, input, ALL, "owner");
    expect(again.replayed).toBe(true);
    expect((await db.listRefundsBySale(saleId, "b1")).length).toBe(1);
  });
  it("serializes approval and rejection of the same requested refund", async () => {
    const { db, svc, saleId } = await setupRefund();
    const sales = new SalesService(db);
    await sales.requestRefund(
      "b1",
      "u1",
      "r-request",
      saleId,
      "customer complaint",
      "refund-race-request",
      ALL,
    );
    const items = await db.listSaleItems(saleId, "b1");
    const originalCreateRefund = db.createRefund.bind(db);
    let enteredCreate!: () => void;
    let releaseCreate!: () => void;
    const createEntered = new Promise<void>((resolve) => {
      enteredCreate = resolve;
    });
    const createReleased = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    db.createRefund = async (input) => {
      enteredCreate();
      await createReleased;
      return originalCreateRefund(input);
    };

    const approving = svc.approveRefund(
      "b1",
      "u2",
      "r-approve",
      saleId,
      {
        items: [{ saleItemId: items[0]!.id, qty: 1 }],
        key: "refund-race-approve",
      },
      ALL,
      "owner",
    );
    await createEntered;

    let rejectSettled = false;
    const rejecting = svc
      .rejectRefund(
        "b1",
        "u3",
        "r-reject",
        saleId,
        "not justified",
        ALL,
      )
      .finally(() => {
        rejectSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rejectSettled).toBe(false);

    releaseCreate();
    await approving;
    await expect(rejecting).rejects.toThrow("SALE_INVALID_TRANSITION");
  });
});

describe("phase11 refund approval threshold", () => {
  it("requires refund.override above the configured threshold", async () => {
    const { db, svc, saleId } = await setupRefund();
    const settings = await db.getSettings("b1");
    await db.saveSettings("b1", { ...settings, refundApprovalThresholdMinor: 3000 });
    const items = await db.listSaleItems(saleId, "b1");
    // 2 x 25.00 = 50.00, above the 30.00 threshold: the approver needs refund.override.
    await expect(
      svc.approveRefund("b1", "u2", "r-th1", saleId, {
        items: [{ saleItemId: items[0].id, qty: 2 }], key: "ref-th-1",
      }, ALL, "manager"),
    ).rejects.toThrow("FORBIDDEN");
    const ok = await svc.approveRefund("b1", "u2", "r-th2", saleId, {
      items: [{ saleItemId: items[0].id, qty: 2 }], key: "ref-th-2",
    }, [...ALL, "refund.override"], "manager");
    expect(ok.refund.status).toBe("APPROVED");
  });

  it("leaves refunds at or below the threshold unchanged", async () => {
    const { db, svc, saleId } = await setupRefund();
    const settings = await db.getSettings("b1");
    await db.saveSettings("b1", { ...settings, refundApprovalThresholdMinor: 10000 });
    const items = await db.listSaleItems(saleId, "b1");
    const out = await svc.approveRefund("b1", "u2", "r-th3", saleId, {
      items: [{ saleItemId: items[0].id, qty: 1 }], key: "ref-th-3",
    }, ALL, "manager");
    expect(out.refund.status).toBe("APPROVED");
  });
});

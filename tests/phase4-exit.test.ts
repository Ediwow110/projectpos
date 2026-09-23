import { describe, expect, it } from "vitest";
import { computeSaleTotals } from "../apps/api/src/sales/totals";
import { transitionSale } from "../apps/api/src/sales/state-machine";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";

async function setup() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 5 });
  return { db, svc: new SalesService(db), productId: prod.id, ALL: ["discount.override", "sale.void", "sale.refund", "cost.view"] };
}

describe("phase4 exit", () => {
  it("completes a sale without duplicate charge or ambiguous inventory", async () => {
    const { db, svc, productId, ALL } = await setup();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const done = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "exit-key-1", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    const bal = await db.findBalance(productId, "b1");
    const ledger = await db.listMovements(productId, "b1");
    expect(bal!.qtyOnHand).toBe(3);
    expect(ledger.reduce((s, m) => s + m.qtyDelta, 0)).toBe(-2);
    expect(ledger.every((m) => m.type === "sale")).toBe(true);
    expect(done.sale.totalMinor).toBe(computeSaleTotals({
      lines: [{ qty: 2, priceMinor: 2500, costMinor: 1000, taxRateBps: null, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0, businessTaxRateBps: null,
    }).totalMinor);
  });
  it("invalid transitions rejected", () => {
    expect(() => transitionSale("DRAFT", "COMPLETED")).toThrow("SALE_INVALID_TRANSITION");
  });
  it("concurrent last-stock sales: one succeeds, ledger consistent", async () => {
    const { db, svc, productId, ALL } = await setup();
    const a = await svc.createDraft("b1", "u1", "ra", {
      lines: [{ productId, qty: 5, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const b = await svc.createDraft("b1", "u1", "rb", {
      lines: [{ productId, qty: 5, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const results = await Promise.allSettled([
      svc.completeSale("b1", "u1", "rc", a.id, {
        payments: [{ method: "cash", amountMinor: a.totalMinor }], key: "exit-ca", granted: ALL,
      }),
      svc.completeSale("b1", "u1", "rd", b.id, {
        payments: [{ method: "cash", amountMinor: b.totalMinor }], key: "exit-cb", granted: ALL,
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const blocked = results.filter(
      (r) => r.status === "rejected" && String(r.reason).includes("INSUFFICIENT_STOCK"),
    ).length;
    expect(ok).toBe(1);
    expect(blocked).toBe(1);
    expect((await db.findBalance(productId, "b1"))!.qtyOnHand).toBe(0);
  });
  it("unknown payment is recoverable through reconcile", async () => {
    const { svc, productId, ALL } = await setup();
    const draft = await svc.createDraft("b1", "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const pending = await svc.completeSale("b1", "u1", "r2", draft.id, {
      payments: [{ method: "gcash", amountMinor: draft.totalMinor, providerRef: "unknown-9" }],
      key: "exit-ku", granted: ALL,
    });
    expect(pending.sale.status).toBe("PAYMENT_UNKNOWN");
    const paymentId = pending.sale.payments[0].id;
    const rec = await svc.reconcilePayment("b1", "u1", "r3", paymentId, "SUCCEEDED", "exit-kr");
    expect(rec.sale.status).toBe("COMPLETED");
  });
});

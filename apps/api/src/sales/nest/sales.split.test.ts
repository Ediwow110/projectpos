import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { SalesService } from "./sales.service";

const GRANT = ["discount.override", "sale.void", "sale.refund"];

async function setup() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Split Store", currency: "PHP" });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Cola", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: business.id, branchId: null, productId: product.id, qtyOnHand: 50 });
  return { db, business, product, sales: new SalesService(db) };
}

describe("phase10 split payment settlement", () => {
  it("waits for every unknown leg before completing the sale", async () => {
    const { db, business, product, sales } = await setup();
    const draft = await sales.createDraft(business.id, "u1", "r1", {
      lines: [{ productId: product.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, GRANT);
    const pending = await sales.completeSale(business.id, "u1", "r1", draft.id, {
      payments: [
        { method: "gcash", amountMinor: 2500, providerRef: "unknown-leg-1" },
        { method: "maya", amountMinor: 2500, providerRef: "unknown-leg-2" },
      ],
      key: "split-unknown",
      granted: GRANT,
    });
    expect(pending.sale.status).toBe("PAYMENT_UNKNOWN");
    const payments = await db.listPaymentsBySale(draft.id, business.id);
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.status === "UNKNOWN")).toBe(true);

    const first = await sales.reconcilePayment(
      business.id, "u1", "r2", payments[0]!.id, "SUCCEEDED", "split-rec-1",
    );
    // One settled leg is not a settled sale.
    expect(first.sale.status).toBe("PAYMENT_UNKNOWN");
    expect((await db.findBalance(product.id, business.id, null))!.qtyOnHand).toBe(50);

    const second = await sales.reconcilePayment(
      business.id, "u1", "r3", payments[1]!.id, "SUCCEEDED", "split-rec-2",
    );
    expect(second.sale.status).toBe("COMPLETED");
    // Stock is applied once, for the whole sale.
    expect((await db.findBalance(product.id, business.id, null))!.qtyOnHand).toBe(48);
  });

  it("does not complete a sale whose remaining leg failed", async () => {
    const { db, business, product, sales } = await setup();
    const draft = await sales.createDraft(business.id, "u1", "r1", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, GRANT);
    await sales.completeSale(business.id, "u1", "r1", draft.id, {
      payments: [
        { method: "gcash", amountMinor: 1250, providerRef: "unknown-leg-a" },
        { method: "maya", amountMinor: 1250, providerRef: "unknown-leg-b" },
      ],
      key: "split-partial",
      granted: GRANT,
    });
    const payments = await db.listPaymentsBySale(draft.id, business.id);
    await sales.reconcilePayment(business.id, "u1", "r2", payments[0]!.id, "SUCCEEDED", "partial-rec-1");
    const failed = await sales.reconcilePayment(
      business.id, "u1", "r3", payments[1]!.id, "FAILED", "partial-rec-2",
    );
    expect(failed.sale.status).toBe("PAYMENT_FAILED");
    expect((await db.findBalance(product.id, business.id, null))!.qtyOnHand).toBe(50);
  });

  it("accepts a split that repeats the same payment method", async () => {
    const { db, business, product, sales } = await setup();
    const draft = await sales.createDraft(business.id, "u1", "r1", {
      lines: [{ productId: product.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, GRANT);
    const done = await sales.completeSale(business.id, "u1", "r1", draft.id, {
      payments: [
        { method: "cash", amountMinor: 2500 },
        { method: "cash", amountMinor: 2500 },
      ],
      key: "same-method-split",
      granted: GRANT,
    });
    expect(done.sale.status).toBe("COMPLETED");
    const payments = await db.listPaymentsBySale(draft.id, business.id);
    expect(payments).toHaveLength(2);
    expect(new Set(payments.map((p) => p.idempotencyKey)).size).toBe(2);
  });

  it("stamps the settlement time used for usage metering", async () => {
    const { db, business, product, sales } = await setup();
    const draft = await sales.createDraft(business.id, "u1", "r1", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, GRANT);
    await sales.completeSale(business.id, "u1", "r1", draft.id, {
      payments: [{ method: "cash", amountMinor: 2500 }],
      key: "stamp-completed",
      granted: GRANT,
    });
    const stored = (await db.listSalesByBusiness(business.id)).find((s) => s.id === draft.id)!;
    expect(stored.completedAt).not.toBeNull();
    expect(stored.completedAt!.getTime()).toBeGreaterThan(0);
  });
});

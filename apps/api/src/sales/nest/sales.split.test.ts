import { describe, afterEach, expect, it } from "vitest";
import { PATH_METADATA } from "@nestjs/common/constants";
import { createMemoryDb } from "../../common/memory.db";
import { clearTestDoubleOutcomes, setTestDoubleOutcome } from "../../payments/provider";
import { PaymentsController } from "./payments.controller";
import { ReceiptsController } from "./receipts.controller";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";

const GRANT = ["discount.override", "sale.void", "sale.refund"];

describe("sales controller split", () => {
  it("retains the API version prefix on every split controller", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SalesController)).toBe("api/v1");
    expect(Reflect.getMetadata(PATH_METADATA, PaymentsController)).toBe("api/v1");
    expect(Reflect.getMetadata(PATH_METADATA, ReceiptsController)).toBe("api/v1");
  });
});

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

describe("phase10 gated data on paid surfaces", () => {
  it("hides the expense total from plans without the expenses entitlement", async () => {
    const { db, business, product, sales } = await setup();
    const { BillingService } = await import("../../billing/nest/billing.service");
    const { ReportingService } = await import("../../reports/nest/reporting.service");
    const billing = new BillingService(db);
    const draft = await sales.createDraft(business.id, "u1", "r1", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, GRANT);
    await sales.completeSale(business.id, "u1", "r1", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "overview-sale", granted: GRANT,
    });
    await db.createExpense({
      businessId: business.id, category: "misc", amountMinor: 5000, description: null,
      method: "cash", shiftId: null, branchId: null, expenseDate: new Date(),
      actorId: "u1", requestId: "r-exp", attachmentUrl: null,
      voidedAt: null, voidReason: null, cashAdjusted: true,
    });
    const reporting = new ReportingService(db);
    const range = {
      from: new Date(Date.now() - 7 * 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
    };
    const free = await db.findPlanByKey("free");
    await db.upsertSubscription({
      businessId: business.id, planId: free!.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    const freeOverview = await reporting.getOverview(business.id, { ...range, compare: "none" }, "owner", ["cost.view"]);
    expect(freeOverview.kpis.expenseTotal.value).toBeNull();

    await billing.changePlan(business.id, "platform", "r-plan", "pro");
    const proOverview = await reporting.getOverview(business.id, { ...range, compare: "none" }, "owner", ["cost.view"]);
    expect(proOverview.kpis.expenseTotal.value).toBe(5000);
  });

  it("refuses to attach a customer on a plan without customers", async () => {
    const { db, business, product, sales } = await setup();
    const { BillingService } = await import("../../billing/nest/billing.service");
    const customer = await db.createCustomer({
      businessId: business.id, name: "Ana", phone: null, email: null,
      address: null, notes: null, isActive: true,
    });
    const free = await db.findPlanByKey("free");
    await db.upsertSubscription({
      businessId: business.id, planId: free!.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    await expect(
      sales.createDraft(business.id, "u1", "r1", {
        lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }],
        orderDiscountMinor: 0, customerId: customer.id,
      }, GRANT),
    ).rejects.toThrow("PLAN_LIMIT");

    await new BillingService(db).changePlan(business.id, "platform", "r-plan", "pro");
    const ok = await sales.createDraft(business.id, "u1", "r2", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0, customerId: customer.id,
    }, GRANT);
    expect(ok.customerId).toBe(customer.id);
  });
});

describe("phase10 split payment settlement", () => {
  afterEach(() => clearTestDoubleOutcomes());

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
    // The provider confirms both legs. Reconcile settles a hosted leg on the
    // provider's verdict, never on the caller's assertion, so a split test has
    // to say what the provider said.
    setTestDoubleOutcome("unknown-leg-1", "SUCCEEDED", business.id);
    setTestDoubleOutcome("unknown-leg-2", "SUCCEEDED", business.id);
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
    // Leg A is provider-confirmed; leg B is reconciled as failed, which the
    // provider gate lets through unexamined because it is the conservative
    // direction.
    setTestDoubleOutcome("unknown-leg-a", "SUCCEEDED", business.id);
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

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { SalesService } from "../../sales/nest/sales.service";
import { ShiftService } from "../../shifts/nest/shift.service";
import { RefundService } from "./refund.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setupRefund() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Refund test", currency: "PHP" });
  const businessId = business.id;
  const shifts = new ShiftService(db);
  const reg = await shifts.createRegister(businessId, "u1", "r0", { name: "Counter 1" }, "owner");
  await shifts.openShift(businessId, "u1", "r1", reg.id, { openingFloatMinor: 0 }, "cashier");
  const prod = await db.createProduct({
    businessId: businessId, categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: businessId, productId: prod.id, qtyOnHand: 10 });
  const svc = new SalesService(db);
  const draft = await svc.createDraft(businessId, "u1", "r2", {
    lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: reg.id,
  }, ALL);
  await svc.completeSale(businessId, "u1", "r3", draft.id, {
    payments: [{ method: "cash", amountMinor: draft.totalMinor }],
    key: "refund-setup-1", granted: ALL,
  });
  return { db, svc: new RefundService(db), saleId: draft.id, productId: prod.id, businessId };
}

describe("phase6 refund service", () => {
  it("refunds the discounted line amount instead of the pre-discount gross", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Refund test", currency: "PHP" });
    const businessId = business.id;
    const shifts = new ShiftService(db);
    const reg = await shifts.createRegister(businessId, "u1", "r0-discount", { name: "Discount Counter" }, "owner");
    await shifts.openShift(businessId, "u1", "r1-discount", reg.id, { openingFloatMinor: 0 }, "cashier");
    const prod = await db.createProduct({
      businessId: businessId, categoryId: null, name: "Discount Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: businessId, productId: prod.id, qtyOnHand: 10 });
    const sales = new SalesService(db);
    const draft = await sales.createDraft(businessId, "u1", "r2-discount", {
      lines: [{ productId: prod.id, qty: 2, lineDiscountMinor: 1000 }],
      orderDiscountMinor: 0,
      registerId: reg.id,
    }, ALL);
    await sales.completeSale(businessId, "u1", "r3-discount", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "discount-refund-sale",
      granted: ALL,
    });
    const items = await db.listSaleItems(draft.id, businessId);
    const refunds = new RefundService(db);
    const out = await refunds.approveRefund(businessId, "u1", "r4-discount", draft.id, {
      items: [{ saleItemId: items[0]!.id, qty: 1 }],
      key: "discount-refund-approve",
    }, ALL, "owner");
    expect(out.refund.totalMinor).toBe(2000);
  });

  it("approves a full refund with all four compensating writes", async () => {
    const { db, svc, businessId, saleId, productId } = await setupRefund();
    const items = await db.listSaleItems(saleId, businessId);
    const out = await svc.approveRefund(businessId, "u1", "r4", saleId, {
      items: [{ saleItemId: items[0].id, qty: 2 }], key: "ref-approve-1",
    }, ALL, "owner");
    expect(out.sale.status).toBe("REFUNDED");
    expect((await db.findBalance(productId, businessId))!.qtyOnHand).toBe(10);
    expect((await db.listPaymentsBySale(saleId, businessId)).some((p) => p.status === "REFUNDED")).toBe(true);
    const open = (await db.findOpenShiftByRegister(businessId, (await db.findSaleById(saleId, businessId))!.registerId!))!;
    expect((await db.listCashMovementsByShift(open.id, businessId)).some((m) => m.type === "cash_refund")).toBe(true);
    const actions = (await db.listAudit()).map((a) => a.action);
    expect(actions).toContain("refund.approve");
  });

  it("accrues and reverses loyalty rewards expense and liability from sale snapshots", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Loyalty refund accounting", currency: "PHP" });
    const customer = await db.createCustomer({ businessId: business.id, name: "Loyalty buyer", email: null, phone: null, address: null, notes: null, isActive: true });
    await db.upsertLoyaltyProgram({ businessId: business.id, enabled: true, earnAmountMinor: 100, earnPoints: 1, redeemPoints: 1, redeemValueMinor: 1, minimumRedeemPoints: null, version: 1 });
    const shifts = new ShiftService(db);
    const register = await shifts.createRegister(business.id, "u1", "loyalty-r0", { name: "Loyalty counter" }, "owner");
    await shifts.openShift(business.id, "u1", "loyalty-r1", register.id, { openingFloatMinor: 0 }, "cashier");
    const product = await db.createProduct({ businessId: business.id, categoryId: null, name: "Reward item", sku: "RW", barcode: null, brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    await db.upsertBalance({ businessId: business.id, productId: product.id, qtyOnHand: 2 });
    const sales = new SalesService(db);
    const sale = await sales.createDraft(business.id, "u1", "loyalty-r2", { lines: [{ productId: product.id, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: register.id }, ALL);
    await db.updateSale(sale.id, business.id, { customerId: customer.id });
    await sales.completeSale(business.id, "u1", "loyalty-r3", sale.id, { payments: [{ method: "cash", amountMinor: sale.totalMinor }], key: "loyalty-reward-sale", granted: ALL });
    const accounts = await db.listAccountingAccounts(business.id);
    const liability = accounts.find((row) => row.code === "2320")!;
    const rewardsExpense = accounts.find((row) => row.code === "6000")!;
    const saleEntry = (await db.findJournalEntryBySource(business.id, "Sale", sale.id, "completed"))!;
    const saleLines = await db.listJournalLines(saleEntry.entry.id, business.id);
    expect(saleLines.find((row) => row.accountId === liability.id)?.creditMinor).toBe(50);
    expect(saleLines.find((row) => row.accountId === rewardsExpense.id)?.debitMinor).toBe(50);
    const saleItems = await db.listSaleItems(sale.id, business.id);
    await new RefundService(db).approveRefund(business.id, "u1", "loyalty-r4", sale.id, { items: [{ saleItemId: saleItems[0]!.id, qty: 2 }], key: "loyalty-reward-refund" }, ALL, "owner");
    const refund = (await db.listRefundsBySale(sale.id, business.id))[0]!;
    const refundEntry = (await db.findJournalEntryBySource(business.id, "Refund", refund.id, "approved"))!;
    const refundLines = await db.listJournalLines(refundEntry.entry.id, business.id);
    expect(refundLines.find((row) => row.accountId === liability.id)?.debitMinor).toBe(50);
    expect(refundLines.find((row) => row.accountId === rewardsExpense.id)?.creditMinor).toBe(50);
  });

  it("reverses a gift-card load without restocking merchandise or reversing loyalty", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Refund test", currency: "PHP" });
    const businessId = business.id;
    const shifts = new ShiftService(db);
    const register = await shifts.createRegister(businessId, "u1", "r0-load-refund", { name: "Load Counter" }, "owner");
    await shifts.openShift(businessId, "u1", "r1-load-refund", register.id, { openingFloatMinor: 0 }, "cashier");
    const prod = await db.createProduct({ businessId: businessId, categoryId: null, name: "Load item", sku: null, barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 500, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    await db.upsertBalance({ businessId: businessId, productId: prod.id, qtyOnHand: 3 });
    const sales = new SalesService(db);
    const draft = await sales.createDraft(businessId, "u1", "r2-load-refund", { lines: [{ productId: prod.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: register.id, giftCardLoad: { amountMinor: 1000, kind: "NEW" } }, ALL);
    await sales.completeSale(businessId, "u1", "r3-load-refund", draft.id, { payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "load-refund-sale", granted: ALL });
    const load = (await db.listSaleGiftCardLoads(draft.id, businessId))[0]!;
    const card = await db.findGiftCardById(load.giftCardId!, businessId);
    expect(card).toBeTruthy();
    const refund = new RefundService(db);
    const out = await refund.approveRefund(businessId, "u1", "r4-load-refund", draft.id, { items: [], loadRefunds: [{ loadId: load.id, amountMinor: 1000 }], key: "load-refund-approve" }, ALL, "owner");
    expect(out.refund.totalMinor).toBe(1000);
    expect(out.sale.status).toBe("PARTIALLY_REFUNDED");
    expect((await db.findBalance(prod.id, businessId))!.qtyOnHand).toBe(2);
    const tx = await db.listGiftCardTransactions(card!.id, businessId);
    expect(tx.filter((row) => row.type === "LOAD_REFUND")).toHaveLength(1);
    expect(tx.find((row) => row.type === "LOAD_REFUND")?.amountDeltaMinor).toBe(-1000);
    expect((await db.listRefundItemsBySale(draft.id, businessId))).toEqual([]);
  });
  it("keeps sale completion and refund symmetric when the live bundle changes", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Refund test", currency: "PHP" });
    const businessId = business.id;
    const shifts = new ShiftService(db);
    const register = await shifts.createRegister(businessId, "u1", "r0-bundle", { name: "Bundle Counter" }, "owner");
    await shifts.openShift(businessId, "u1", "r1-bundle", register.id, { openingFloatMinor: 0 }, "cashier");
    const componentA = await db.createProduct({ businessId: businessId, categoryId: null, name: "Bundle A", sku: "BA", barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    const componentB = await db.createProduct({ businessId: businessId, categoryId: null, name: "Bundle B", sku: "BB", barcode: null, brand: null, unit: "pc", costMinor: 150, priceMinor: 300, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    const bundleProduct = await db.createProduct({ businessId: businessId, categoryId: null, name: "Snapshot bundle", sku: "BUNDLE-SNAP", barcode: null, brand: null, unit: "kit", costMinor: 250, priceMinor: 700, taxRateBps: null, reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null, productType: "BUNDLE" });
    const bundle = await db.createProductBundle({ businessId: businessId, bundleProductId: bundleProduct.id, version: 1 });
    await db.createBundleComponent({ businessId: businessId, bundleId: bundle.id, componentProductId: componentA.id, quantity: 1, position: 0 });
    await db.createBundleComponent({ businessId: businessId, bundleId: bundle.id, componentProductId: componentB.id, quantity: 1, position: 1 });
    await db.upsertBalance({ businessId: businessId, productId: componentA.id, qtyOnHand: 10 });
    await db.upsertBalance({ businessId: businessId, productId: componentB.id, qtyOnHand: 10 });
    const sales = new SalesService(db);
    const draft = await sales.createDraft(businessId, "u1", "r2-bundle", { lines: [{ productId: bundleProduct.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId: register.id }, ALL);
    const items = await db.listSaleItems(draft.id, businessId);
    expect(await db.listSaleItemBundleComponents(items[0]!.id, businessId)).toHaveLength(2);
    await db.deleteBundleComponents(bundle.id, businessId);
    await db.createBundleComponent({ businessId: businessId, bundleId: bundle.id, componentProductId: componentA.id, quantity: 2, position: 0 });
    await db.createBundleComponent({ businessId: businessId, bundleId: bundle.id, componentProductId: componentB.id, quantity: 1, position: 1 });
    await db.updateProductBundle(bundle.id, businessId, { version: 2 });
    await sales.completeSale(businessId, "u1", "r3-bundle", draft.id, { payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "bundle-snapshot-sale", granted: ALL });
    expect((await db.findBalance(componentA.id, businessId))!.qtyOnHand).toBe(9);
    expect((await db.findBalance(componentB.id, businessId))!.qtyOnHand).toBe(9);
    const refund = new RefundService(db);
    await refund.approveRefund(businessId, "u1", "r4-bundle", draft.id, { items: [{ saleItemId: items[0]!.id, qty: 1 }], key: "bundle-snapshot-refund" }, ALL, "owner");
    expect((await db.findBalance(componentA.id, businessId))!.qtyOnHand).toBe(10);
    expect((await db.findBalance(componentB.id, businessId))!.qtyOnHand).toBe(10);
  });
  it("rejects over-quantity refunds with nothing written", async () => {
    const { db, svc, businessId, saleId } = await setupRefund();
    const items = await db.listSaleItems(saleId, businessId);
    await expect(
      svc.approveRefund(businessId, "u1", "r4", saleId, {
        items: [{ saleItemId: items[0].id, qty: 99 }], key: "ref-approve-2",
      }, ALL, "owner"),
    ).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
    expect(await db.listRefundsBySale(saleId, businessId)).toEqual([]);
  });
  it("rejects duplicate line entries whose combined quantity exceeds the refundable amount", async () => {
    const { db, svc, businessId, saleId } = await setupRefund();
    const items = await db.listSaleItems(saleId, businessId);
    await expect(svc.approveRefund(businessId, "u1", "r-duplicate-lines", saleId, {
      items: [{ saleItemId: items[0].id, qty: 2 }, { saleItemId: items[0].id, qty: 1 }],
      key: "ref-duplicate-lines",
    }, ALL, "owner")).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
    expect(await db.listRefundsBySale(saleId, businessId)).toHaveLength(0);
  });
  it("rejects self-approval by non-owners", async () => {
    const { db, svc, businessId, saleId } = await setupRefund();
    const sales = new SalesService(db);
    await sales.requestRefund(businessId, "u1", "r4b", saleId, "customer complaint", "req-key-3", ALL);
    const items = await db.listSaleItems(saleId, businessId);
    await expect(
      svc.approveRefund(businessId, "u1", "r5", saleId, {
        items: [{ saleItemId: items[0].id, qty: 1 }], key: "ref-approve-3",
      }, ALL, "manager"),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("replays approve keys without duplicate writes", async () => {
    const { db, svc, businessId, saleId } = await setupRefund();
    const items = await db.listSaleItems(saleId, businessId);
    const input = { items: [{ saleItemId: items[0].id, qty: 1 }], key: "ref-approve-4" };
    await svc.approveRefund(businessId, "u1", "r4", saleId, input, ALL, "owner");
    const again = await svc.approveRefund(businessId, "u1", "r5", saleId, input, ALL, "owner");
    expect(again.replayed).toBe(true);
    expect((await db.listRefundsBySale(saleId, businessId)).length).toBe(1);
  });
  it("serializes approval and rejection of the same requested refund", async () => {
    const { db, svc, businessId, saleId } = await setupRefund();
    const sales = new SalesService(db);
    await sales.requestRefund(
      businessId,
      "u1",
      "r-request",
      saleId,
      "customer complaint",
      "refund-race-request",
      ALL,
    );
    const items = await db.listSaleItems(saleId, businessId);
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
      businessId,
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
        businessId,
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
    const { db, svc, businessId, saleId } = await setupRefund();
    const settings = await db.getSettings(businessId);
    await db.saveSettings(businessId, { ...settings, refundApprovalThresholdMinor: 3000 });
    const items = await db.listSaleItems(saleId, businessId);
    // 2 x 25.00 = 50.00, above the 30.00 threshold: the approver needs refund.override.
    await expect(
      svc.approveRefund(businessId, "u2", "r-th1", saleId, {
        items: [{ saleItemId: items[0].id, qty: 2 }], key: "ref-th-1",
      }, ALL, "manager"),
    ).rejects.toThrow("FORBIDDEN");
    const ok = await svc.approveRefund(businessId, "u2", "r-th2", saleId, {
      items: [{ saleItemId: items[0].id, qty: 2 }], key: "ref-th-2",
    }, [...ALL, "refund.override"], "manager");
    expect(ok.refund.status).toBe("APPROVED");
  });

  it("leaves refunds at or below the threshold unchanged", async () => {
    const { db, svc, businessId, saleId } = await setupRefund();
    const settings = await db.getSettings(businessId);
    await db.saveSettings(businessId, { ...settings, refundApprovalThresholdMinor: 10000 });
    const items = await db.listSaleItems(saleId, businessId);
    const out = await svc.approveRefund(businessId, "u2", "r-th3", saleId, {
      items: [{ saleItemId: items[0].id, qty: 1 }], key: "ref-th-3",
    }, ALL, "manager");
    expect(out.refund.status).toBe("APPROVED");
    expect(await db.findJournalEntryBySource(businessId, "Refund", out.refund.id, "approved")).not.toBeNull();
  });
});

async function setupDeliveryRefund() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Refund test", currency: "PHP" });
  const businessId = business.id;
  const product = await db.createProduct({
    businessId: businessId, categoryId: null, name: "Delivery item", sku: "DEL-1", barcode: null,
    brand: null, unit: "pc", costMinor: 500, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: businessId, productId: product.id, qtyOnHand: 9 });
  const sale = await db.createSale({
    businessId: businessId, receiptNo: "DEL-0001", status: "COMPLETED",
    subtotalMinor: 5000, discountMinor: 0, taxMinor: 0,
    deliveryFeeMinor: 1000, deliveryTaxMinor: 120, totalMinor: 6120,
    paidMinor: 6120, changeMinor: 0, currency: "PHP", customerId: null, customerName: "Guest",
    notes: null, actorId: "u1", requestId: "delivery-sale", idempotencyKey: null, registerId: null,
    branchId: null, completedAt: new Date(), createdAt: new Date(),
  });
  const item = await db.createSaleItem({
    businessId: businessId, saleId: sale.id, productId: product.id, name: product.name, unit: "pc",
    qty: 2, priceMinor: 2500, costMinor: 500, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 5000,
  });
  await db.createPayment({
    businessId: businessId, saleId: sale.id, method: "cash", amountMinor: 3000,
    status: "SUCCEEDED", providerRef: null, idempotencyKey: "delivery-pay-1",
  });
  await db.createPayment({
    businessId: businessId, saleId: sale.id, method: "card", amountMinor: 3120,
    status: "SUCCEEDED", providerRef: null, idempotencyKey: "delivery-pay-2",
  });
  return { db, svc: new RefundService(db), sale, item, product, businessId };
}

describe("phase22 delivery charge refunds", () => {
  it("refunds only the full remaining delivery charge, persists the fee/tax split, and creates no stock effect", async () => {
    const { db, svc, sale, product } = await setupDeliveryRefund();
    const beforeMovements = await db.listMovements(product.id, sale.businessId);
    const beforeBalance = await db.findBalance(product.id, sale.businessId);
    const out = await svc.approveRefund(sale.businessId, "u1", "delivery-refund", sale.id, {
      items: [],
      deliveryRefundMinor: 1120,
      key: "delivery-refund-key",
    }, ALL, "owner");
    expect(out.refund).toMatchObject({
      totalMinor: 1120,
      deliveryFeeRefundMinor: 1000,
      deliveryTaxRefundMinor: 120,
    });
    expect(out.sale.status).toBe("PARTIALLY_REFUNDED");
    expect(await db.listMovements(product.id, sale.businessId)).toEqual(beforeMovements);
    expect(await db.findBalance(product.id, sale.businessId)).toEqual(beforeBalance);

    await expect(svc.approveRefund(sale.businessId, "u1", "delivery-refund-2", sale.id, {
      items: [],
      deliveryRefundMinor: 1120,
      key: "delivery-refund-key-2",
    }, ALL, "owner")).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
  });

  it("rejects a partial delivery refund instead of silently splitting the charge", async () => {
    const { svc, sale } = await setupDeliveryRefund();
    await expect(svc.approveRefund(sale.businessId, "u1", "delivery-partial", sale.id, {
      items: [],
      deliveryRefundMinor: 500,
      key: "delivery-partial-key",
    }, ALL, "owner")).rejects.toThrow("VALIDATION");
  });

  it("skips original-tender capacity already consumed by prior approved refunds", async () => {
    const { db, svc, sale, item } = await setupDeliveryRefund();
    await svc.approveRefund(sale.businessId, "u1", "merch-refund", sale.id, {
      items: [{ saleItemId: item.id, qty: 1 }],
      key: "merch-first",
    }, ALL, "owner");
    const before = await db.listPaymentsBySale(sale.id, sale.businessId);
    expect(before.filter((p) => p.status === "REFUNDED" && p.method === "cash")
      .reduce((sum, p) => sum + p.amountMinor, 0)).toBe(2500);

    await svc.approveRefund(sale.businessId, "u1", "delivery-after-merch", sale.id, {
      items: [],
      deliveryRefundMinor: 1120,
      key: "delivery-after-merch",
    }, ALL, "owner");
    const payments = await db.listPaymentsBySale(sale.id, sale.businessId);
    const refundedCash = payments.filter((p) => p.status === "REFUNDED" && p.method === "cash")
      .reduce((sum, p) => sum + p.amountMinor, 0);
    const refundedCard = payments.filter((p) => p.status === "REFUNDED" && p.method === "card")
      .reduce((sum, p) => sum + p.amountMinor, 0);
    expect(refundedCash).toBe(3000);
    expect(refundedCard).toBe(620);
  });

  it("marks REFUNDED only after both merchandise and delivery are fully reversed", async () => {
    const { db, svc, sale, item } = await setupDeliveryRefund();
    const merchandise = await svc.approveRefund(sale.businessId, "u1", "merch-full", sale.id, {
      items: [{ saleItemId: item.id, qty: 2 }],
      key: "merch-full-key",
    }, ALL, "owner");
    expect(merchandise.sale.status).toBe("PARTIALLY_REFUNDED");
    const final = await svc.approveRefund(sale.businessId, "u1", "delivery-final", sale.id, {
      items: [],
      deliveryRefundMinor: 1120,
      key: "delivery-final-key",
    }, ALL, "owner");
    expect(final.sale.status).toBe("REFUNDED");
    expect((await db.listRefundsBySale(sale.id, sale.businessId))
      .reduce((sum, row) => sum + row.totalMinor, 0)).toBe(6120);
  });
});

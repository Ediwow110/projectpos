import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../../common/memory.db";
import { SalesService } from "../../sales/nest/sales.service";
import { ShiftService } from "../../shifts/nest/shift.service";
import { ExchangeService } from "./exchange.service";

const OWNER = ["discount.override", "sale.void", "sale.refund", "refund.override", "cost.view"];

async function setupExchange(opts?: { originalMethod?: "cash" | "card" }) {
  const db = createMemoryDb();
  const shifts = new ShiftService(db);
  const register = await shifts.createRegister("b1", "owner-1", "reg-create", { name: "Exchange Counter" }, "owner");
  await shifts.openShift("b1", "owner-1", "shift-open", register.id, { openingFloatMinor: 0 }, "cashier");
  const returnedProduct = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Original Shirt", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  const replacementProduct = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Replacement Shirt", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1200, priceMinor: 3000, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  const cheaperProduct = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Cheaper Shirt", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 500, priceMinor: 1000, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: returnedProduct.id, qtyOnHand: 10 });
  await db.upsertBalance({ businessId: "b1", productId: replacementProduct.id, qtyOnHand: 10 });
  await db.upsertBalance({ businessId: "b1", productId: cheaperProduct.id, qtyOnHand: 10 });
  await db.saveSettings("b1", { paymentMethods: [{ key: "cash", label: "Cash" }, { key: "card", label: "Card" }] });
  const sales = new SalesService(db);
  const draft = await sales.createDraft("b1", "owner-1", "sale-draft", {
    lines: [{ productId: returnedProduct.id, qty: 1, lineDiscountMinor: 0 }],
    orderDiscountMinor: 0,
    registerId: register.id,
  }, OWNER);
  await sales.completeSale("b1", "owner-1", "sale-complete", draft.id, {
    payments: [{ method: opts?.originalMethod ?? "cash", amountMinor: draft.totalMinor }],
    key: "original-sale-complete",
    granted: OWNER,
  });
  const item = (await db.listSaleItems(draft.id, "b1"))[0]!;
  return { db, register, originalSaleId: draft.id, item, returnedProduct, replacementProduct, cheaperProduct };
}

describe("direct exchange service", () => {
  it("resolves an approved exchange concern only after the linked exchange executes", async () => {
    const { db, originalSaleId, item, replacementProduct } = await setupExchange();
    const sale = (await db.findSaleById(originalSaleId, "b1"))!;
    const concern = await db.createCustomerConcern({
      businessId: "b1", saleId: originalSaleId, receiptNo: sale.receiptNo, branchId: sale.branchId ?? null,
      registerId: sale.registerId, requesterId: "cashier-1", reason: "WRONG_ITEM", outcome: "EXCHANGE", note: null,
      items: [{ saleItemId: item.id, name: item.name, qty: 1, amountMinor: 2500 }], requestedRefundMinor: 2500,
      status: "APPROVED", idempotencyKey: "case-exchange", reviewedBy: "manager-1", reviewedAt: new Date(),
      reviewReason: "Exchange approved", refundId: null,
    });
    const result = await new ExchangeService(db).completeExchange("b1", "owner-1", "exchange-case", originalSaleId, {
      returns: [{ saleItemId: item.id, qty: 1 }], replacements: [{ productId: replacementProduct.id, qty: 1 }],
      reason: "Case exchange", concernId: concern.id, key: "exchange-case-key",
    }, OWNER, "owner");
    expect(await db.findCustomerConcernById(concern.id, "b1")).toMatchObject({ status: "RESOLVED", refundId: result.refund.id });
    expect((await db.listAudit()).map((entry) => entry.action)).toContain("customer_concern.exchange_execute");
  });

  it("rejects exchanges whose return lines do not match the approved concern", async () => {
    const { db, originalSaleId, item, replacementProduct } = await setupExchange();
    const sale = (await db.findSaleById(originalSaleId, "b1"))!;
    const concern = await db.createCustomerConcern({
      businessId: "b1", saleId: originalSaleId, receiptNo: sale.receiptNo, branchId: sale.branchId ?? null,
      registerId: sale.registerId, requesterId: "cashier-1", reason: "WRONG_ITEM", outcome: "EXCHANGE", note: null,
      items: [{ saleItemId: item.id, name: item.name, qty: 1, amountMinor: 2500 }], requestedRefundMinor: 2500,
      status: "APPROVED", idempotencyKey: "case-exchange-mismatch", reviewedBy: "manager-1", reviewedAt: new Date(),
      reviewReason: "Exchange approved", refundId: null,
    });
    await expect(new ExchangeService(db).completeExchange("b1", "owner-1", "exchange-case-mismatch", originalSaleId, {
      returns: [{ saleItemId: item.id, qty: 2 }], replacements: [{ productId: replacementProduct.id, qty: 1 }],
      reason: "Changed return", concernId: concern.id, key: "exchange-case-mismatch-key",
    }, OWNER, "owner")).rejects.toThrow("CONCERN_NOT_APPROVED");
    expect(await db.listRefundsBySale(originalSaleId, "b1")).toEqual([]);
    expect(await db.findCustomerConcernById(concern.id, "b1")).toMatchObject({ status: "APPROVED", refundId: null });
  });

  it("links a full return to a replacement sale and exposes the net amount to collect", async () => {
    const { db, originalSaleId, item, returnedProduct, replacementProduct } = await setupExchange();
    const service = new ExchangeService(db);
    const result = await service.completeExchange("b1", "owner-1", "exchange-r1", originalSaleId, {
      returns: [{ saleItemId: item.id, qty: 1 }],
      replacements: [{ productId: replacementProduct.id, qty: 1 }],
      reason: "Wrong size",
      key: "exchange-1",
    }, OWNER, "owner");

    expect(result.exchange).toMatchObject({ returnMinor: 2500, replacementMinor: 3000, netMinor: 500, direction: "COLLECT" });
    expect(result.refund.totalMinor).toBe(2500);
    expect(result.replacementSale.status).toBe("COMPLETED");
    expect(result.replacementSale.totalMinor).toBe(3000);
    expect((await db.findSaleById(originalSaleId, "b1"))?.status).toBe("REFUNDED");
    expect((await db.findBalance(returnedProduct.id, "b1"))?.qtyOnHand).toBe(10);
    expect((await db.findBalance(replacementProduct.id, "b1"))?.qtyOnHand).toBe(9);
    expect((await db.listAudit()).some((entry) => entry.action === "exchange.complete" && entry.entityId === result.exchange.id)).toBe(true);
  });

  it("reports the exact net customer refund when the replacement is cheaper", async () => {
    const { db, originalSaleId, item, cheaperProduct } = await setupExchange();
    const result = await new ExchangeService(db).completeExchange("b1", "owner-1", "exchange-r2", originalSaleId, {
      returns: [{ saleItemId: item.id, qty: 1 }],
      replacements: [{ productId: cheaperProduct.id, qty: 1 }],
      reason: "Customer chose cheaper item",
      key: "exchange-2",
    }, OWNER, "owner");
    expect(result.exchange).toMatchObject({ returnMinor: 2500, replacementMinor: 1000, netMinor: -1500, direction: "REFUND" });
  });

  it("replays the same exchange key without duplicating refund or replacement sale", async () => {
    const { db, originalSaleId, item, replacementProduct } = await setupExchange();
    const service = new ExchangeService(db);
    const input = {
      returns: [{ saleItemId: item.id, qty: 1 }],
      replacements: [{ productId: replacementProduct.id, qty: 1 }],
      reason: "Wrong size",
      key: "exchange-replay",
    };
    const first = await service.completeExchange("b1", "owner-1", "exchange-r3", originalSaleId, input, OWNER, "owner");
    const second = await service.completeExchange("b1", "owner-1", "exchange-r4", originalSaleId, input, OWNER, "owner");
    expect(second.replayed).toBe(true);
    expect(second.exchange.id).toBe(first.exchange.id);
    expect(await db.listRefundsBySale(originalSaleId, "b1")).toHaveLength(1);
  });

  it("rejects cashier execution and non-cash original tenders", async () => {
    const cash = await setupExchange();
    await expect(new ExchangeService(cash.db).completeExchange("b1", "cashier-1", "exchange-r5", cash.originalSaleId, {
      returns: [{ saleItemId: cash.item.id, qty: 1 }], replacements: [{ productId: cash.replacementProduct.id, qty: 1 }], reason: "Wrong size", key: "exchange-cashier",
    }, [], "cashier")).rejects.toThrow("FORBIDDEN");

    const card = await setupExchange({ originalMethod: "card" });
    await expect(new ExchangeService(card.db).completeExchange("b1", "owner-1", "exchange-r6", card.originalSaleId, {
      returns: [{ saleItemId: card.item.id, qty: 1 }], replacements: [{ productId: card.replacementProduct.id, qty: 1 }], reason: "Wrong size", key: "exchange-card",
    }, OWNER, "owner")).rejects.toThrow("EXCHANGE_CASH_ONLY");
  });

  it("does not refund anything when the replacement product is invalid", async () => {
    const { db, originalSaleId, item } = await setupExchange();
    await expect(new ExchangeService(db).completeExchange("b1", "owner-1", "exchange-r7", originalSaleId, {
      returns: [{ saleItemId: item.id, qty: 1 }], replacements: [{ productId: "missing-product", qty: 1 }], reason: "Wrong size", key: "exchange-invalid",
    }, OWNER, "owner")).rejects.toThrow("VALIDATION");
    expect(await db.listRefundsBySale(originalSaleId, "b1")).toEqual([]);
  });
});

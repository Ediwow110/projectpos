import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../../common/memory.db";
import { SalesService } from "../../sales/nest/sales.service";
import { ShiftService } from "../../shifts/nest/shift.service";
import { ExchangeService } from "./exchange.service";

const OWNER = ["discount.override", "sale.void", "sale.refund", "refund.override", "cost.view"];

async function setupExchange(opts?: { originalMethod?: "cash" | "card" }) {
  const db = createMemoryDb();
  const businessId = (await db.createBusiness({ name: "Exchange", currency: "PHP" })).id;
  const shifts = new ShiftService(db);
  const register = await shifts.createRegister(businessId, "owner-1", "reg-create", { name: "Exchange Counter" }, "owner");
  await shifts.openShift(businessId, "owner-1", "shift-open", register.id, { openingFloatMinor: 0 }, "cashier");
  const returnedProduct = await db.createProduct({
    businessId: businessId, categoryId: null, name: "Original Shirt", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  const replacementProduct = await db.createProduct({
    businessId: businessId, categoryId: null, name: "Replacement Shirt", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1200, priceMinor: 3000, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  const cheaperProduct = await db.createProduct({
    businessId: businessId, categoryId: null, name: "Cheaper Shirt", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 500, priceMinor: 1000, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: businessId, productId: returnedProduct.id, qtyOnHand: 10 });
  await db.upsertBalance({ businessId: businessId, productId: replacementProduct.id, qtyOnHand: 10 });
  await db.upsertBalance({ businessId: businessId, productId: cheaperProduct.id, qtyOnHand: 10 });
  await db.saveSettings(businessId, { paymentMethods: [{ key: "cash", label: "Cash" }, { key: "card", label: "Card" }] });
  const sales = new SalesService(db);
  const draft = await sales.createDraft(businessId, "owner-1", "sale-draft", {
    lines: [{ productId: returnedProduct.id, qty: 1, lineDiscountMinor: 0 }],
    orderDiscountMinor: 0,
    registerId: register.id,
  }, OWNER);
  await sales.completeSale(businessId, "owner-1", "sale-complete", draft.id, {
    payments: [{ method: opts?.originalMethod ?? "cash", amountMinor: draft.totalMinor }],
    key: "original-sale-complete",
    granted: OWNER,
  });
  const item = (await db.listSaleItems(draft.id, businessId))[0]!;
  return { db, businessId, register, originalSaleId: draft.id, item, returnedProduct, replacementProduct, cheaperProduct };
}

describe("direct exchange service", () => {
  it("links a full return to a replacement sale and exposes the net amount to collect", async () => {
    const { db, originalSaleId, item, returnedProduct, replacementProduct , businessId } = await setupExchange();
    const service = new ExchangeService(db);
    const result = await service.completeExchange(businessId, "owner-1", "exchange-r1", originalSaleId, {
      returns: [{ saleItemId: item.id, qty: 1 }],
      replacements: [{ productId: replacementProduct.id, qty: 1 }],
      reason: "Wrong size",
      key: "exchange-1",
    }, OWNER, "owner");

    expect(result.exchange).toMatchObject({ returnMinor: 2500, replacementMinor: 3000, netMinor: 500, direction: "COLLECT" });
    expect(result.refund.totalMinor).toBe(2500);
    expect(result.replacementSale.status).toBe("COMPLETED");
    expect(result.replacementSale.totalMinor).toBe(3000);
    expect((await db.findSaleById(originalSaleId, businessId))?.status).toBe("REFUNDED");
    expect((await db.findBalance(returnedProduct.id, businessId))?.qtyOnHand).toBe(10);
    expect((await db.findBalance(replacementProduct.id, businessId))?.qtyOnHand).toBe(9);
    expect((await db.listAudit()).some((entry) => entry.action === "exchange.complete" && entry.entityId === result.exchange.id)).toBe(true);
  });

  it("reports the exact net customer refund when the replacement is cheaper", async () => {
    const { db, originalSaleId, item, cheaperProduct , businessId } = await setupExchange();
    const result = await new ExchangeService(db).completeExchange(businessId, "owner-1", "exchange-r2", originalSaleId, {
      returns: [{ saleItemId: item.id, qty: 1 }],
      replacements: [{ productId: cheaperProduct.id, qty: 1 }],
      reason: "Customer chose cheaper item",
      key: "exchange-2",
    }, OWNER, "owner");
    expect(result.exchange).toMatchObject({ returnMinor: 2500, replacementMinor: 1000, netMinor: -1500, direction: "REFUND" });
  });

  it("replays the same exchange key without duplicating refund or replacement sale", async () => {
    const { db, originalSaleId, item, replacementProduct , businessId } = await setupExchange();
    const service = new ExchangeService(db);
    const input = {
      returns: [{ saleItemId: item.id, qty: 1 }],
      replacements: [{ productId: replacementProduct.id, qty: 1 }],
      reason: "Wrong size",
      key: "exchange-replay",
    };
    const first = await service.completeExchange(businessId, "owner-1", "exchange-r3", originalSaleId, input, OWNER, "owner");
    const second = await service.completeExchange(businessId, "owner-1", "exchange-r4", originalSaleId, input, OWNER, "owner");
    expect(second.replayed).toBe(true);
    expect(second.exchange.id).toBe(first.exchange.id);
    expect(await db.listRefundsBySale(originalSaleId, businessId)).toHaveLength(1);
  });

  it("rejects cashier execution and non-cash original tenders", async () => {
    const cash = await setupExchange();
    await expect(new ExchangeService(cash.db).completeExchange(cash.businessId, "cashier-1", "exchange-r5", cash.originalSaleId, {
      returns: [{ saleItemId: cash.item.id, qty: 1 }], replacements: [{ productId: cash.replacementProduct.id, qty: 1 }], reason: "Wrong size", key: "exchange-cashier",
    }, [], "cashier")).rejects.toThrow("FORBIDDEN");

    const card = await setupExchange({ originalMethod: "card" });
    await expect(new ExchangeService(card.db).completeExchange(card.businessId, "owner-1", "exchange-r6", card.originalSaleId, {
      returns: [{ saleItemId: card.item.id, qty: 1 }], replacements: [{ productId: card.replacementProduct.id, qty: 1 }], reason: "Wrong size", key: "exchange-card",
    }, OWNER, "owner")).rejects.toThrow("EXCHANGE_CASH_ONLY");
  });

  it("does not refund anything when the replacement product is invalid", async () => {
    const { db, originalSaleId, item , businessId } = await setupExchange();
    await expect(new ExchangeService(db).completeExchange(businessId, "owner-1", "exchange-r7", originalSaleId, {
      returns: [{ saleItemId: item.id, qty: 1 }], replacements: [{ productId: "missing-product", qty: 1 }], reason: "Wrong size", key: "exchange-invalid",
    }, OWNER, "owner")).rejects.toThrow("VALIDATION");
    expect(await db.listRefundsBySale(originalSaleId, businessId)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { SalesService } from "../sales/nest/sales.service";
import { StoredValueService } from "./stored-value.service";

describe("Phase 20 stored-value sale integration", () => {
  async function fixture() {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Value POS", currency: "PHP" });
    const customer = await db.createCustomer({ businessId: business.id, name: "Loyal Customer", phone: null, email: null, address: null, notes: null, isActive: true });
    const product = await db.createProduct({ businessId: business.id, categoryId: null, name: "Coffee", sku: null, barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 500, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    await db.upsertBalance({ businessId: business.id, productId: product.id, qtyOnHand: 10 });
    const value = new StoredValueService(db);
    const card = await value.issueGiftCard(business.id, "u1", "r1", "issue-card-1");
    await value.adjustGiftCard(business.id, "u1", "r2", card.card.id, 500, "initial load", "load-card-1");
    return { db, business, customer, product, value, card, sales: new SalesService(db) };
  }

  it("debits a gift card atomically and records the internal instrument", async () => {
    const { db, business, customer, product, card, value, sales } = await fixture();
    const draft = await sales.createDraft(business.id, "u1", "r3", { lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, customerId: customer.id }, ["discount.override"]);
    const result = await sales.completeSale(business.id, "u1", "r4", draft.id, { payments: [{ method: "gift_card", amountMinor: draft.totalMinor, internalInstrumentId: card.card.id }], key: "complete-card-1", granted: [] });
    expect(result.sale.status).toBe("COMPLETED");
    expect(await value.giftCardBalance(business.id, card.card.id)).toBe(0);
    expect((await db.listPaymentsBySale(draft.id, business.id))[0]).toMatchObject({ method: "gift_card", internalInstrumentId: card.card.id });
  });

  it("rolls back inventory and stored value when a debit cannot fund the sale", async () => {
    const { db, business, customer, product, card, value, sales } = await fixture();
    await value.adjustGiftCard(business.id, "u1", "r5b", card.card.id, -400, "reserve existing value", "reserve-card-2");
    const draft = await sales.createDraft(business.id, "u1", "r5", { lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, customerId: customer.id }, []);
    await expect(sales.completeSale(business.id, "u1", "r6", draft.id, { payments: [{ method: "gift_card", amountMinor: draft.totalMinor, internalInstrumentId: card.card.id }], key: "complete-card-2", granted: [] })).rejects.toThrow("GIFT_CARD_INSUFFICIENT_BALANCE");
    expect(await value.giftCardBalance(business.id, card.card.id)).toBe(100);
    expect((await db.findBalance(product.id, business.id))?.qtyOnHand).toBe(10);
    expect(await db.listPaymentsBySale(draft.id, business.id)).toHaveLength(0);
  });

  it("creates a new gift card only at completed load and returns its code once", async () => {
    const { db, business, product, sales } = await fixture();
    const draft = await sales.createDraft(business.id, "u1", "r7", { lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, giftCardLoad: { amountMinor: 1000, kind: "NEW" } }, []);
    const result = await sales.completeSale(business.id, "u1", "r8", draft.id, { payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "complete-load-1", granted: [] });
    expect(result.giftCardCodes).toHaveLength(1);
    expect((await db.listGiftCards(business.id))).toHaveLength(2);
    expect((await db.listPaymentsBySale(draft.id, business.id))[0]?.method).toBe("cash");
  });
});

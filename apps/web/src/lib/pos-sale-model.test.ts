import { describe, expect, it } from "vitest";

import {
  addProductToCart,
  applyCartDiscounts,
  buildDraftSaleInput,
  buildOfflineSalePayload,
  changeCartQuantity,
  filterOfflineCatalog,
  heldSaleToCart,
  isPayMongoMethodKey,
  posDiscountSummary,
  resolveTenderedMinor,
} from "./pos-sale-model";

describe("POS sale model", () => {
  it("restores held-sale items in their saved cashier order", () => {
    expect(heldSaleToCart({
      items: [
        { position: 1, productId: "p2", name: "Second", priceMinor: 2000, qty: 2, lineDiscountMinor: 500 },
        { position: 0, productId: "p1", name: "First", priceMinor: 1000, qty: 1, lineDiscountMinor: 100 },
      ],
    })).toEqual([
      { productId: "p1", name: "First", priceMinor: 1000, qty: 1, lineDiscountMinor: 100 },
      { productId: "p2", name: "Second", priceMinor: 2000, qty: 2, lineDiscountMinor: 500 },
    ]);
  });

  it("builds draft input without empty optional customer/register fields", () => {
    const cart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 500 }];
    expect(buildDraftSaleInput(cart, "", "", "  Walk In  ", 300)).toEqual({
      lines: [{ productId: "p1", qty: 2, lineDiscountMinor: 500 }],
      orderDiscountMinor: 300,
      customerName: "Walk In",
    });
    expect(buildDraftSaleInput(cart, "reg1", "cust1", "Ignored", 0)).toEqual({
      lines: [{ productId: "p1", qty: 2, lineDiscountMinor: 500 }],
      orderDiscountMinor: 0,
      registerId: "reg1",
      customerId: "cust1",
    });
  });

  it("uses the due total when cash received is blank and builds an offline cash payload", () => {
    const cart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1, lineDiscountMinor: 0 }];
    expect(resolveTenderedMinor("", 2500)).toBe(2500);
    expect(resolveTenderedMinor("30.50", 2500)).toBe(3050);
    expect(buildOfflineSalePayload(cart, "", "", "Walk In", 3000, 0)).toEqual({
      lines: [{ productId: "p1", qty: 1, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0,
      customerName: "Walk In",
      payments: [{ method: "cash", amountMinor: 3000 }],
    });
  });

  it("keeps cart updates and offline catalog filtering deterministic", () => {
    const coffee = { id: "p1", name: "Coffee", sku: "CF-1", categoryId: "c1", priceMinor: 2500, isActive: true };
    const tea = { id: "p2", name: "Tea", sku: "TE-1", categoryId: "c2", priceMinor: 1500, isActive: true };
    let cart = addProductToCart([], coffee);
    cart = addProductToCart(cart, coffee);
    expect(cart).toEqual([{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 0 }]);
    expect(changeCartQuantity(cart, "p1", -2)).toEqual([]);
    expect(filterOfflineCatalog([coffee, tea], "cf", "c1")).toEqual([coffee]);
  });

  it("applies fixed line and order discounts in minor units and caps them to the sale value", () => {
    const cart = [
      { productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 0 },
      { productId: "p2", name: "Tea", priceMinor: 1500, qty: 1, lineDiscountMinor: 0 },
    ];
    const discounted = applyCartDiscounts(cart, { p1: 1200, p2: 9999 });
    expect(discounted).toEqual([
      { ...cart[0], lineDiscountMinor: 1200 },
      { ...cart[1], lineDiscountMinor: 1500 },
    ]);
    expect(posDiscountSummary(discounted, 8000)).toEqual({
      grossMinor: 6500,
      lineDiscountMinor: 2700,
      subtotalMinor: 3800,
      orderDiscountMinor: 3800,
      totalDiscountMinor: 6500,
      totalMinor: 0,
    });
  });

  it("caps a line discount after quantity is reduced", () => {
    const cart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 4000 }];
    expect(changeCartQuantity(cart, "p1", -1)).toEqual([
      { productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1, lineDiscountMinor: 2500 },
    ]);
  });

  it("identifies only PayMongo-backed checkout methods", () => {
    for (const key of ["card", "gcash", "maya", "qrph"]) expect(isPayMongoMethodKey(key)).toBe(true);
    for (const key of ["cash", "bank_transfer", "other"]) expect(isPayMongoMethodKey(key)).toBe(false);
  });
});

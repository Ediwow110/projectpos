import { describe, expect, it } from "vitest";

import {
  addProductToCart,
  buildDraftSaleInput,
  buildOfflineSalePayload,
  changeCartQuantity,
  filterOfflineCatalog,
  isPayMongoMethodKey,
  resolveTenderedMinor,
} from "./pos-sale-model";

describe("POS sale model", () => {
  it("builds draft input without empty optional customer/register fields", () => {
    const cart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2 }];
    expect(buildDraftSaleInput(cart, "", "", "  Walk In  ")).toEqual({
      lines: [{ productId: "p1", qty: 2 }],
      customerName: "Walk In",
    });
    expect(buildDraftSaleInput(cart, "reg1", "cust1", "Ignored")).toEqual({
      lines: [{ productId: "p1", qty: 2 }],
      registerId: "reg1",
      customerId: "cust1",
    });
  });

  it("uses the due total when cash received is blank and builds an offline cash payload", () => {
    const cart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1 }];
    expect(resolveTenderedMinor("", 2500)).toBe(2500);
    expect(resolveTenderedMinor("30.50", 2500)).toBe(3050);
    expect(buildOfflineSalePayload(cart, "", "", "Walk In", 3000)).toEqual({
      lines: [{ productId: "p1", qty: 1 }],
      customerName: "Walk In",
      payments: [{ method: "cash", amountMinor: 3000 }],
    });
  });

  it("keeps cart updates and offline catalog filtering deterministic", () => {
    const coffee = { id: "p1", name: "Coffee", sku: "CF-1", categoryId: "c1", priceMinor: 2500, isActive: true };
    const tea = { id: "p2", name: "Tea", sku: "TE-1", categoryId: "c2", priceMinor: 1500, isActive: true };
    let cart = addProductToCart([], coffee);
    cart = addProductToCart(cart, coffee);
    expect(cart).toEqual([{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2 }]);
    expect(changeCartQuantity(cart, "p1", -2)).toEqual([]);
    expect(filterOfflineCatalog([coffee, tea], "cf", "c1")).toEqual([coffee]);
  });

  it("identifies only PayMongo-backed checkout methods", () => {
    for (const key of ["card", "gcash", "maya", "qrph"]) expect(isPayMongoMethodKey(key)).toBe(true);
    for (const key of ["cash", "bank_transfer", "other"]) expect(isPayMongoMethodKey(key)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  paymentStatusCopy,
  reconcileCartForCatalog,
  replaceWithServerTotals,
  storefrontErrorMessage,
  validatePublicCheckout,
} from "./orders";

describe("public ordering helpers", () => {
  it("validates pickup and delivery payment rules", () => {
    expect(validatePublicCheckout({
      branchId: "br_1",
      fulfillmentMode: "PICKUP",
      paymentMode: "PAY_AT_PICKUP",
      paymentMethod: null,
      deliveryAddressComplete: false,
    })).toEqual([]);

    expect(validatePublicCheckout({
      branchId: "br_1",
      fulfillmentMode: "DELIVERY",
      paymentMode: "PAY_AT_PICKUP",
      paymentMethod: null,
      deliveryAddressComplete: true,
    })).toContain("Delivery requires prepaid payment.");

    expect(validatePublicCheckout({
      branchId: "br_1",
      fulfillmentMode: "DELIVERY",
      paymentMode: "PREPAID",
      paymentMethod: "gcash",
      deliveryAddressComplete: false,
    })).toContain("Enter a complete delivery address.");

    expect(validatePublicCheckout({
      branchId: "br_1",
      fulfillmentMode: "PICKUP",
      paymentMode: "PREPAID",
      paymentMethod: null,
      deliveryAddressComplete: false,
    })).toContain("Choose a payment method.");
  });

  it("requires an explicit branch before checkout", () => {
    expect(validatePublicCheckout({
      branchId: "",
      fulfillmentMode: "PICKUP",
      paymentMode: "PAY_AT_PICKUP",
      paymentMethod: null,
      deliveryAddressComplete: false,
    })).toContain("Choose a store location.");
  });

  it("blocks checkout while branch availability is still being revalidated", () => {
    expect(validatePublicCheckout({
      branchId: "br_1",
      fulfillmentMode: "PICKUP",
      paymentMode: "PAY_AT_PICKUP",
      paymentMethod: null,
      deliveryAddressComplete: false,
      catalogReady: false,
    })).toContain("Wait for product availability to finish loading.");
  });

  it("reconciles cart quantities when a branch change reduces availability", () => {
    const out = reconcileCartForCatalog(
      [
        { productId: "p1", qty: 3 },
        { productId: "p2", qty: 1 },
        { productId: "p3", qty: 2 },
      ],
      [
        { id: "p1", availableToSell: 1 },
        { id: "p2", availableToSell: 0 },
        { id: "p3", availableToSell: null },
      ],
    );
    expect(out.lines).toEqual([
      { productId: "p1", qty: 1 },
      { productId: "p3", qty: 2 },
    ]);
    expect(out.adjustedProductIds).toEqual(["p1", "p2"]);
  });

  it("replaces optimistic totals with the authoritative server totals", () => {
    expect(replaceWithServerTotals(
      { subtotalMinor: 900, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 900 },
      { subtotalMinor: 1000, discountMinor: 100, taxMinor: 108, deliveryFeeMinor: 150, deliveryTaxMinor: 18, totalMinor: 1176 },
    )).toEqual({
      subtotalMinor: 1000,
      discountMinor: 100,
      taxMinor: 108,
      deliveryFeeMinor: 150,
      deliveryTaxMinor: 18,
      totalMinor: 1176,
    });
  });

  it("uses explicit safe copy for failed and unknown payments", () => {
    expect(paymentStatusCopy("FAILED")).toContain("Payment failed");
    expect(paymentStatusCopy("UNKNOWN")).toContain("Do not pay again");
    expect(paymentStatusCopy("UNKNOWN")).not.toContain("paid");
  });

  it("explains disabled or unavailable online ordering without leaking tenant detail", () => {
    expect(storefrontErrorMessage("NOT_FOUND")).toBe("Online ordering is not available for this store.");
    expect(storefrontErrorMessage("NETWORK_ERROR")).toBe("Could not load this storefront. Try again.");
  });
});

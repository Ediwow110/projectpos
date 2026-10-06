import { describe, expect, it } from "vitest";
import {
  buildOrderListPath,
  isAgedOperationalHold,
  onlineOrderingSettingsPayload,
  orderCapabilitiesForRole,
  orderDetailActions,
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

  it("builds bounded staff Order queries and preserves the opaque cursor", () => {
    expect(buildOrderListPath({
      limit: 25,
      status: "CONFIRMED",
      fulfillmentMode: "PICKUP",
      paymentStatus: "UNPAID",
      cursor: "opaque+/cursor==",
    })).toBe(
      "/api/v1/orders?limit=25&status=CONFIRMED&fulfillmentMode=PICKUP&paymentStatus=UNPAID&cursor=opaque%2B%2Fcursor%3D%3D",
    );
    expect(() => buildOrderListPath({ limit: 101 })).toThrow("VALIDATION");
  });

  it("builds online-ordering settings without tenant IDs and converts delivery pesos to minor units", () => {
    expect(onlineOrderingSettingsPayload({
      enabled: true,
      pickupBranchIds: ["br_pickup"],
      deliveryBranchId: "br_delivery",
      deliveryFeePesos: "49.50",
    })).toEqual({
      onlineOrderingEnabled: true,
      onlinePickupBranchIds: ["br_pickup"],
      onlineFulfillmentBranchId: "br_delivery",
      deliveryFlatFeeMinor: 4950,
    });
    expect(() => onlineOrderingSettingsPayload({
      enabled: true,
      pickupBranchIds: [],
      deliveryBranchId: null,
      deliveryFeePesos: "-1",
    })).toThrow("VALIDATION");
  });

  it("matches the seeded Order capabilities without granting settings or access management to lower roles", () => {
    expect(orderCapabilitiesForRole("owner")).toMatchObject({
      view: true, settings: true, accept: true, cancel: true, fulfill: true, collect: true, linkCustomer: true, manageAccess: true,
    });
    expect(orderCapabilitiesForRole("manager")).toMatchObject({ view: true, settings: false, fulfill: true, manageAccess: true });
    expect(orderCapabilitiesForRole("cashier")).toMatchObject({ view: true, accept: true, collect: true, cancel: false, fulfill: false, manageAccess: false });
    expect(orderCapabilitiesForRole("inventory")).toMatchObject({ view: true, accept: false, collect: false, cancel: false, fulfill: true, manageAccess: false });
  });

  it("derives only state-valid Order and fulfillment actions", () => {
    expect(orderDetailActions({
      role: "cashier",
      orderStatus: "SUBMITTED",
      paymentMode: "PAY_AT_PICKUP",
      fulfillment: null,
    })).toEqual(["accept"]);
    expect(orderDetailActions({
      role: "inventory",
      orderStatus: "CONFIRMED",
      paymentMode: "PREPAID",
      fulfillment: { type: "DELIVERY", status: "PACKED" },
    })).toEqual(["assign", "dispatch"]);
    expect(orderDetailActions({
      role: "owner",
      orderStatus: "CONFIRMED",
      paymentMode: "PREPAID",
      fulfillment: { type: "PICKUP", status: "READY" },
    })).toEqual(expect.arrayContaining(["assign", "collect", "cancel", "resend-access", "revoke-access"]));
  });

  it("flags only non-expiring HELD reservations older than 24 hours", () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    expect(isAgedOperationalHold({
      status: "HELD",
      expiresAt: null,
      createdAt: "2026-10-05T11:59:59.000Z",
    }, now)).toBe(true);
    expect(isAgedOperationalHold({
      status: "HELD",
      expiresAt: "2026-10-06T12:20:00.000Z",
      createdAt: "2026-10-05T00:00:00.000Z",
    }, now)).toBe(false);
    expect(isAgedOperationalHold({
      status: "COMMITTED",
      expiresAt: null,
      createdAt: "2026-10-04T00:00:00.000Z",
    }, now)).toBe(false);
  });
});

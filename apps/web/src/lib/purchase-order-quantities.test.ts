import { describe, expect, it } from "vitest";
import { receivedPurchaseOrderQty, returnedPurchaseOrderQty, type PurchaseOrder } from "./purchase-orders";

const order = {
  receipts: [
    { lines: [{ purchaseOrderLineId: "a", quantityReceived: 2 }, { purchaseOrderLineId: "b", quantityReceived: 5 }] },
    { lines: [{ purchaseOrderLineId: "a", quantityReceived: 3 }] },
  ],
  supplierReturns: [
    { status: "POSTED", lines: [{ purchaseOrderLineId: "a", quantity: 1 }] },
    { status: "DRAFT", lines: [{ purchaseOrderLineId: "a", quantity: 4 }] },
    { status: "POSTED", lines: [{ purchaseOrderLineId: "b", quantity: 2 }] },
  ],
} as PurchaseOrder;

describe("purchase-order quantity projections", () => {
  it("sums received quantity across receipts by exact line identifier", () => {
    expect(receivedPurchaseOrderQty(order, "a")).toBe(5);
    expect(receivedPurchaseOrderQty(order, "b")).toBe(5);
    expect(receivedPurchaseOrderQty(order, "missing")).toBe(0);
  });
  it("counts only posted supplier returns", () => {
    expect(returnedPurchaseOrderQty(order, "a")).toBe(1);
    expect(returnedPurchaseOrderQty(order, "b")).toBe(2);
  });
  it("handles absent receipt and return arrays", () => {
    expect(receivedPurchaseOrderQty({} as PurchaseOrder, "a")).toBe(0);
    expect(returnedPurchaseOrderQty({} as PurchaseOrder, "a")).toBe(0);
  });
});

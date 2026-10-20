import { describe, expect, it } from "vitest";

import { createMemoryDb } from "./memory.db";

describe("customer concern persistence", () => {
  it("lists only a tenant's concerns after creating a pending request", async () => {
    const db = createMemoryDb();
    const first = await db.createCustomerConcern({
      businessId: "b1",
      saleId: "sale-1",
      receiptNo: "2026-000001",
      branchId: "branch-1",
      registerId: "register-1",
      requesterId: "cashier-1",
      reason: "DAMAGED",
      outcome: "REFUND",
      note: "Packaging was open.",
      items: [{ saleItemId: "line-1", name: "Coffee", qty: 1, amountMinor: 2500 }],
      requestedRefundMinor: 2500,
      status: "PENDING",
      idempotencyKey: "concern-key-1",
      reviewedBy: null,
      reviewReason: null,
      refundId: null,
    });
    await db.createCustomerConcern({
      businessId: "b2",
      saleId: "sale-other",
      receiptNo: "2026-000001",
      branchId: "branch-1",
      registerId: "register-1",
      requesterId: "cashier-2",
      reason: "DAMAGED",
      outcome: "REFUND",
      note: null,
      items: [{ saleItemId: "line-1", name: "Coffee", qty: 1, amountMinor: 2500 }],
      requestedRefundMinor: 2500,
      status: "PENDING",
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
      refundId: null,
      idempotencyKey: "concern-key-2",
    });

    const rows = await db.listCustomerConcernsByBusiness("b1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: "b1",
      saleId: "sale-1",
      requestedRefundMinor: 2500,
      status: "PENDING",
      items: [{ saleItemId: "line-1", qty: 1 }],
    });
    expect(rows[0]!.id).toBe(first.id);
  });
});

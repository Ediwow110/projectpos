import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";

describe("customer concerns PostgreSQL persistence", () => {
  it("persists JSON snapshots, tenant-scoped lookup and compare-and-transition", async () => {
    await withPg(async (db, ctx) => {
      const business = await db.createBusiness({ name: "Concern PG", currency: "PHP" });
      const other = await db.createBusiness({ name: "Other Concern PG", currency: "PHP" });
      const sale = await db.createSale({
        businessId: business.id, receiptNo: "PG-CASE-1", status: "COMPLETED", subtotalMinor: 2400,
        discountMinor: 0, taxMinor: 0, totalMinor: 2400, paidMinor: 2400, changeMinor: 0,
        currency: "PHP", customerId: null, customerName: null, notes: null, actorId: "cashier",
        requestId: "sale-request", idempotencyKey: null, registerId: null, branchId: null, createdAt: new Date(),
      });
      const concern = await db.createCustomerConcern({
        businessId: business.id, saleId: sale.id, receiptNo: sale.receiptNo, branchId: null, registerId: null,
        requesterId: "cashier", reason: "DAMAGED", outcome: "REFUND", note: "Opened package",
        items: [{ saleItemId: "line-1", name: "Coffee", qty: 1, amountMinor: 2400 }],
        requestedRefundMinor: 2400, status: "PENDING", idempotencyKey: "case-pg-key", reviewedBy: null,
        reviewedAt: null, reviewReason: null, refundId: null,
      });
      expect(await db.findCustomerConcernById(concern.id, other.id)).toBeNull();
      expect(await db.findCustomerConcernByIdempotency(business.id, "case-pg-key")).toMatchObject({
        id: concern.id, items: [{ saleItemId: "line-1", qty: 1 }],
      });
      expect(await db.listCustomerConcernsByBusiness(other.id)).toEqual([]);
      expect(await db.transitionCustomerConcern(concern.id, business.id, "PENDING", {
        status: "APPROVED", reviewedBy: "manager", reviewedAt: new Date(), reviewReason: "Approved",
      })).toMatchObject({ status: "APPROVED", reviewedBy: "manager" });
      expect(await db.transitionCustomerConcern(concern.id, business.id, "PENDING", { status: "REJECTED" })).toBeNull();
      const client = await ctx.client();
      try {
        const rls = await client.query('SELECT "relrowsecurity" FROM pg_class WHERE "relname" = $1', ["CustomerConcern"]);
        expect(rls.rows[0]?.relrowsecurity).toBe(true);
      } finally { if (ctx.owns()) client.release(); }
    });
  });
});

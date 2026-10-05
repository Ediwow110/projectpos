import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { OrderService } from "./order-service";

async function seedOrder(
  db: ReturnType<typeof createMemoryDb>,
  businessId: string,
  createdAt: Date,
  branchId: string,
) {
  const order = await db.createOrder({
    businessId, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
    taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
    version: 1, checkoutAt: createdAt, submittedAt: createdAt, confirmedAt: null, completedAt: null, cancelledAt: null,
    actorId: "u1", requestId: "r1", createdAt, updatedAt: createdAt,
  });
  return order;
}

describe("phase22 order service reads", () => {
  it("delegates bounded filtering/pagination to listOrdersPage and emits stable cursor", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Store", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const spy = vi.spyOn(db, "listOrdersPage");
    const svc = new OrderService(db);
    for (let i = 0; i < 3; i += 1) await seedOrder(db, business.id, new Date(1_700_000_000_000 + i), branch.id);

    const first = await svc.listOrders(business.id, { limit: 2, branchId: branch.id });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    expect(spy).toHaveBeenCalledWith(business.id, expect.objectContaining({ limit: 3, branchId: branch.id }));
    const second = await svc.listOrders(business.id, { limit: 2, branchId: branch.id, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(3);
  });

  it("validates max limit/date range and tenant branch", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Store", currency: "PHP" });
    const other = await db.createBusiness({ name: "Other", currency: "PHP" });
    const foreign = await db.createBranch({ businessId: other.id, name: "Foreign", type: "store", isActive: true });
    const svc = new OrderService(db);
    await expect(svc.listOrders(business.id, { limit: 101 })).rejects.toThrow("VALIDATION");
    await expect(svc.listOrders(business.id, {
      limit: 50,
      dateFrom: "2025-01-01T00:00:00.000Z",
      dateTo: "2026-12-31T00:00:00.000Z",
    })).rejects.toThrow("VALIDATION");
    await expect(svc.listOrders(business.id, { limit: 50, branchId: foreign.id })).rejects.toThrow("VALIDATION");
  });

  it("redacts contact channels and delivery details without the delivery permission", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Store", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const order = await seedOrder(db, business.id, new Date(), branch.id);
    await db.updateOrder(order.id, business.id, {
      deliveryAddress: { line1: "Secret" },
      fulfillmentInstructions: "Gate code",
    }, order.version);
    const svc = new OrderService(db);
    const redacted = await svc.getOrder(business.id, order.id, ["order.view"]);
    expect(redacted.order.email).toBeNull();
    expect(redacted.order.phone).toBeNull();
    expect(redacted.order.deliveryAddress).toBeNull();
    expect(redacted.order.fulfillmentInstructions).toBeNull();
    const full = await svc.getOrder(business.id, order.id, ["order.view_delivery_details"]);
    expect(full.order.email).toBe("ana@example.com");
    expect(full.order.deliveryAddress).toEqual({ line1: "Secret" });
  });
});

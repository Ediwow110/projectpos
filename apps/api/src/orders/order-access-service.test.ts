import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { OrderAccessService } from "./order-access-service";

async function setup() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Tokens", currency: "PHP" });
  const now = new Date("2026-10-06T12:00:00.000Z");
  const createOrder = (requestId: string) => db.createOrder({
    businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId: null, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 0, discountMinor: 0,
    taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 0, saleId: null, status: "DRAFT",
    version: 1, checkoutAt: null, submittedAt: null, confirmedAt: null, completedAt: null, cancelledAt: null,
    actorId: "public", requestId, createdAt: now, updatedAt: now,
  });
  return { db, business, now, createOrder };
}

describe("phase22 Order access tokens", () => {
  it("mints 32-byte random bearer material while persisting SHA-256 only", async () => {
    const { db, business, now, createOrder } = await setup();
    const order = await createOrder("one");
    const service = new OrderAccessService(db);
    const issued = await service.mintCheckoutToken(business.id, order.id, now);
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(issued.token, "hex")).toHaveLength(32);

    const stored = await db.findOrderAccessTokenByHash(createHash("sha256").update(issued.token).digest("hex"));
    expect(stored).toMatchObject({ orderId: order.id, kind: "CHECKOUT" });
    expect((stored as unknown as { token?: string }).token).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(issued.token);
  });

  it("binds checkout credentials to one Order and enforces expiry/revocation", async () => {
    const { db, business, now, createOrder } = await setup();
    const a = await createOrder("a");
    const b = await createOrder("b");
    const service = new OrderAccessService(db);
    const issued = await service.mintCheckoutToken(business.id, a.id, now);
    await expect(service.requireCheckoutToken(business.id, a.id, issued.token, new Date(now.getTime() + 60_000)))
      .resolves.toMatchObject({ orderId: a.id });
    await expect(service.requireCheckoutToken(business.id, b.id, issued.token, new Date(now.getTime() + 60_000)))
      .rejects.toThrow("FORBIDDEN");
    await expect(service.requireCheckoutToken(business.id, a.id, issued.token, new Date(now.getTime() + 2 * 60 * 60 * 1000 + 1)))
      .rejects.toThrow("FORBIDDEN");

    const second = await service.mintCheckoutToken(business.id, a.id, now);
    await service.revokeCheckoutTokens(business.id, a.id, new Date(now.getTime() + 2_000));
    await expect(service.requireCheckoutToken(business.id, a.id, second.token, new Date(now.getTime() + 3_000)))
      .rejects.toThrow("FORBIDDEN");
  });

  it("allows multiple automatic STATUS links, while resend/revoke invalidates all prior links", async () => {
    const { db, business, now, createOrder } = await setup();
    const order = await createOrder("status");
    const service = new OrderAccessService(db);
    const first = await service.mintStatusToken(business.id, order.id, now);
    const second = await service.mintStatusToken(business.id, order.id, new Date(now.getTime() + 1_000));
    expect((await service.resolveStatusToken(first.token, new Date(now.getTime() + 2_000))).id).toBe(order.id);
    expect((await service.resolveStatusToken(second.token, new Date(now.getTime() + 2_000))).id).toBe(order.id);

    const replacement = await service.replaceStatusTokens(business.id, order.id, new Date(now.getTime() + 3_000));
    await expect(service.resolveStatusToken(first.token, new Date(now.getTime() + 4_000))).rejects.toThrow("FORBIDDEN");
    await expect(service.resolveStatusToken(second.token, new Date(now.getTime() + 4_000))).rejects.toThrow("FORBIDDEN");
    expect((await service.resolveStatusToken(replacement.token, new Date(now.getTime() + 4_000))).id).toBe(order.id);

    await service.revokeStatusTokens(business.id, order.id, new Date(now.getTime() + 5_000));
    await expect(service.resolveStatusToken(replacement.token, new Date(now.getTime() + 6_000))).rejects.toThrow("FORBIDDEN");
  });
});

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import type { TransactionalEmailPort } from "../email/email.service";
import { OrderAccessService } from "./order-access-service";
import { OrderNotificationService } from "./order-notification-service";

async function fixture() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Mail Store", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const now = new Date();
  const order = await db.createOrder({
    businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
    taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
    version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
    actorId: "public", requestId: "mail", createdAt: now, updatedAt: now,
  });
  return { db, business, order };
}

describe("phase22 Order notifications", () => {
  it("mints a fresh STATUS token without revoking prior automatic links", async () => {
    const { db, business, order } = await fixture();
    const sent: string[] = [];
    const email: TransactionalEmailPort = {
      async sendPasswordReset() {}, async sendEmailVerification() {}, async sendReceiptShare() {},
      async sendOrderUpdate(input) { sent.push(input.token); },
    };
    const access = new OrderAccessService(db);
    const first = await access.mint(business.id, order.id, "STATUS", new Date(Date.now() + 86_400_000));
    const service = new OrderNotificationService(db, email);
    expect(await service.sendEvent(business.id, order.id, "CONFIRMED")).toBe(true);
    expect(sent).toHaveLength(1);
    expect(await access.authenticate(first.token, "STATUS", order.id)).toMatchObject({ orderId: order.id });
  });

  it("records failed delivery without rolling back the Order", async () => {
    const { db, business, order } = await fixture();
    const email: TransactionalEmailPort = {
      async sendPasswordReset() {}, async sendEmailVerification() {}, async sendReceiptShare() {},
      async sendOrderUpdate() { throw new Error("EMAIL_DELIVERY_FAILED"); },
    };
    const service = new OrderNotificationService(db, email);
    expect(await service.sendEvent(business.id, order.id, "CONFIRMED")).toBe(false);
    expect((await db.findOrderById(order.id, business.id))?.status).toBe("SUBMITTED");
    expect((await db.listAudit()).some((row) => row.action === "order.notification.failed")).toBe(true);
  });
});

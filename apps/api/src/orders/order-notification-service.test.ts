import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import type { TransactionalEmailPort } from "../email/email.service";
import { OrderAccessService } from "./order-access-service";
import { OrderNotificationService } from "./order-notification-service";
import { OrderService } from "./order-service";

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

  it("preserves existing customer status links when a manual resend fails", async () => {
    const { db, business, order } = await fixture();
    const access = new OrderAccessService(db);
    const prior = await access.mintStatusToken(business.id, order.id);
    let attemptedToken = "";
    const email: TransactionalEmailPort = {
      async sendPasswordReset() {}, async sendEmailVerification() {}, async sendReceiptShare() {},
      async sendOrderUpdate(input) {
        attemptedToken = input.token;
        throw new Error("EMAIL_DELIVERY_FAILED");
      },
    };
    const service = new OrderNotificationService(db, email);
    expect(await service.resend(business.id, order.id)).toBe(false);
    expect(await access.authenticate(prior.token, "STATUS", order.id)).toMatchObject({ orderId: order.id });
    expect(attemptedToken).toHaveLength(64);
    await expect(access.authenticate(attemptedToken, "STATUS", order.id)).rejects.toThrow("NOT_FOUND");
    expect(await db.listActiveOrderAccessTokens(order.id, business.id, "STATUS", new Date())).toHaveLength(1);
    expect((await db.listAudit(business.id)).filter((entry) => entry.action === "order.notification.failed")).toHaveLength(1);
  });

  it("rotates older links only after a new status link is accepted by the email transport", async () => {
    const { db, business, order } = await fixture();
    const access = new OrderAccessService(db);
    const prior = await access.mintStatusToken(business.id, order.id);
    let deliveredToken = "";
    const email: TransactionalEmailPort = {
      async sendPasswordReset() {}, async sendEmailVerification() {}, async sendReceiptShare() {},
      async sendOrderUpdate(input) {
        deliveredToken = input.token;
        // A customer-facing link already issued must still work at the
        // instant the replacement is handed to the email provider.
        expect(await access.authenticate(prior.token, "STATUS", order.id)).toMatchObject({ orderId: order.id });
      },
    };
    const service = new OrderNotificationService(db, email);
    expect(await service.resend(business.id, order.id)).toBe(true);
    await expect(access.authenticate(prior.token, "STATUS", order.id)).rejects.toThrow("NOT_FOUND");
    expect(await access.authenticate(deliveredToken, "STATUS", order.id)).toMatchObject({ orderId: order.id });
    expect(await db.listActiveOrderAccessTokens(order.id, business.id, "STATUS", new Date())).toHaveLength(1);
  });

  it("reports successful email acceptance even when the follow-up audit write fails", async () => {
    const { db, business, order } = await fixture();
    let delivered = "";
    const email: TransactionalEmailPort = {
      async sendPasswordReset() {}, async sendEmailVerification() {}, async sendReceiptShare() {},
      async sendOrderUpdate(input) { delivered = input.token; },
    };
    vi.spyOn(db, "appendAudit").mockRejectedValueOnce(new Error("AUDIT_WRITE_FAILED"));
    const service = new OrderNotificationService(db, email);
    expect(await service.sendEvent(business.id, order.id, "CONFIRMED")).toBe(true);
    expect(await new OrderAccessService(db).authenticate(delivered, "STATUS", order.id))
      .toMatchObject({ orderId: order.id });
  });

  it("returns a truthful idempotent failed resend and allows a new-key recovery", async () => {
    const { db, business, order } = await fixture();
    const access = new OrderAccessService(db);
    const prior = await access.mintStatusToken(business.id, order.id);
    let shouldFail = true;
    let attempts = 0;
    let delivered = "";
    const email: TransactionalEmailPort = {
      async sendPasswordReset() {}, async sendEmailVerification() {}, async sendReceiptShare() {},
      async sendOrderUpdate(input) {
        attempts++;
        if (shouldFail) throw new Error("EMAIL_DELIVERY_FAILED");
        delivered = input.token;
      },
    };
    const orders = new OrderService(db, new OrderNotificationService(db, email));
    expect(await orders.resendAccess(business.id, "staff", "req-1", order.id, "first-key"))
      .toEqual({ sent: false, replayed: false });
    expect(await orders.resendAccess(business.id, "staff", "req-2", order.id, "first-key"))
      .toEqual({ sent: false, replayed: true });
    expect(attempts).toBe(1);
    expect(await access.authenticate(prior.token, "STATUS", order.id)).toMatchObject({ orderId: order.id });

    shouldFail = false;
    expect(await orders.resendAccess(business.id, "staff", "req-3", order.id, "second-key"))
      .toEqual({ sent: true, replayed: false });
    expect(attempts).toBe(2);
    await expect(access.authenticate(prior.token, "STATUS", order.id)).rejects.toThrow("NOT_FOUND");
    expect(await access.authenticate(delivered, "STATUS", order.id)).toMatchObject({ orderId: order.id });
  });
});

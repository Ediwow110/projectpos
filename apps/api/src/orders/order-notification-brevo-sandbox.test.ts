import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { BrevoApiTransport, TransactionalEmailService } from "../email/email.service";
import { OrderNotificationOutboxWorker, createMemoryOrderNotificationOutbox } from "./order-notification-outbox";
import { OrderNotificationService } from "./order-notification-service";

describe("H5-G.4 sandbox-only notification acceptance", () => {
  it("acknowledges one synthetic order via sandbox request without a real provider call", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Isolated H5 QA", currency: "PHP" });
    const branch = await db.createBranch({
      businessId: business.id, name: "QA", type: "store", isActive: true,
    });
    const now = new Date();
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
      branchId: branch.id, customerId: null, contactName: "Synthetic QA",
      email: "synthetic@example.test", phone: null, deliveryAddress: null,
      fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100,
      discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0,
      totalMinor: 100, saleId: null, status: "CONFIRMED", version: 1,
      checkoutAt: now, submittedAt: now, confirmedAt: now,
      completedAt: null, cancelledAt: null, actorId: "qa-only",
      requestId: "h5g-sandbox-order", createdAt: now, updatedAt: now,
    });
    const requests: RequestInit[] = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://api.brevo.com/v3/smtp/email");
      requests.push(init ?? {});
      return new Response(JSON.stringify({ messageId: "synthetic-sandbox-response" }), { status: 201 });
    };
    const email = new TransactionalEmailService(
      new BrevoApiTransport("local-fake-key", fakeFetch, true),
      { from: "NexPOS <noreply@example.test>", webUrl: "https://staging.example.test" },
    );
    const store = createMemoryOrderNotificationOutbox();
    const notifier = new OrderNotificationService(db, email, store);
    await notifier.enqueueEvent(business.id, order.id, "CONFIRMED", "h5g-qa-confirmed");
    const worker = new OrderNotificationOutboxWorker(db, store, notifier);
    const pollTime = new Date(Date.now() + 1_000);
    expect(await worker.runOnce(pollTime)).toEqual({ claimed: 1, sent: 1, retried: 0, dead: 0 });
    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0]!.body));
    expect(body.headers).toEqual({ "X-Sib-Sandbox": "drop" });
    expect(body.to).toEqual([{ email: "synthetic@example.test" }]);
    expect(body.textContent).toContain("/order-status#token=");
    expect((await store.listForTests())[0]).toMatchObject({ status: "SENT", attempts: 1 });
    expect(await worker.runOnce(pollTime)).toMatchObject({ claimed: 0, sent: 0 });
    // An accepted sandbox call is NOT actual delivery. This is a simulated
    // Brevo HTTP response and does not hit the public internet.
  });
});

import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { renderMetrics } from "../common/metrics";
import { OrderNotificationService } from "../orders/order-notification-service";
import { createMemoryOrderNotificationOutbox } from "../orders/order-notification-outbox";
import { OrderSaleService } from "../orders/order-sale-service";
import { ReservationService } from "../orders/reservation-service";
import type {
  PayMongoCheckoutInput,
  PayMongoCheckoutResult,
  PayMongoCheckoutSnapshot,
  PayMongoPort,
} from "../payments/paymongo";
import { SalesService } from "./nest/sales.service";
import { SalesPayMongoWebhookService } from "./paymongo-webhook-service";
import { SalesStockService } from "./sale-stock-service";

class FakePayMongo implements PayMongoPort {
  configured(): boolean { return true; }
  async createCheckout(input: PayMongoCheckoutInput): Promise<PayMongoCheckoutResult> {
    return { sessionId: "cs_" + input.saleId, checkoutUrl: "https://pay.test/cs_" + input.saleId };
  }
  async retrieveCheckout(sessionId: string): Promise<PayMongoCheckoutSnapshot> {
    return { sessionId, checkoutUrl: "https://pay.test/" + sessionId, status: "active", paid: false };
  }
  verifyWebhook(): boolean { return true; }
}

describe("phase22 PayMongo settlement with Order reservations", () => {
  it("commits the own hold, confirms the WEB Order, and deduplicates stock movement", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Webhook web", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Unit", sku: "PW", barcode: null, brand: null,
      unit: "pc", costMinor: 50, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
      trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
    const now = new Date();
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PREPAID",
      branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
      version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public", requestId: "webhook-order", createdAt: now, updatedAt: now,
    });
    await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
      sku: product.sku, barcode: null, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 50,
      taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100, bundleComponentsSnapshot: null, createdAt: now,
    });
    await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "webhook-hold", now);
    const sale = await new OrderSaleService(db).createSaleFromSubmittedOrder(business.id, "staff", "webhook-sale", order.id);
    const outbox = createMemoryOrderNotificationOutbox();
    let outboundOrderUpdates = 0;
    const sales = new SalesService(db, new FakePayMongo(), {
      async sendPasswordReset() {},
      async sendEmailVerification() {},
      async sendReceiptShare() {},
      async sendOrderUpdate() { outboundOrderUpdates++; },
    }, outbox);
    const checkout = await sales.startPayMongoCheckout(
      business.id, "staff", "checkout", sale.id, "gcash", "checkout-key", "https://nexpos.example",
    );
    const payload = {
      data: {
        id: "evt_web_order_paid",
        type: "checkout_session.payment.paid",
        data: {
          id: checkout.checkoutSessionId,
          type: "checkout_session",
          attributes: {
            reference_number: sale.id,
            metadata: { businessId: business.id, saleId: sale.id, method: "gcash" },
            payments: [{
              id: "pay_web_order",
              attributes: { status: "paid", amount: sale.totalMinor, currency: "PHP", source: { type: "gcash" } },
            }],
          },
        },
      },
    };
    const raw = JSON.stringify(payload);
    const first = await sales.handlePayMongoWebhook(raw, "valid", payload, "webhook-1");
    expect(first).toEqual({ handled: true });
    expect((await db.findSaleById(sale.id, business.id))?.status).toBe("COMPLETED");
    expect(await db.findOrderById(order.id, business.id)).toMatchObject({ status: "CONFIRMED" });
    expect(await db.listReservationsByOrder(order.id, business.id)).toEqual([
      expect.objectContaining({ status: "COMMITTED", expiresAt: null }),
    ]);
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(0);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
    expect(await outbox.listForTests()).toEqual([
      expect.objectContaining({
        businessId: business.id, orderId: order.id, event: "CONFIRMED",
        status: "PENDING", attempts: 0,
      }),
    ]);
    expect(outboundOrderUpdates).toBe(0);

    expect(await sales.handlePayMongoWebhook(raw, "valid", payload, "webhook-2"))
      .toEqual({ handled: true, deduplicated: true });
    expect(await db.listFulfillmentsByOrder(order.id, business.id)).toHaveLength(1);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
    expect(await outbox.listForTests()).toHaveLength(1);
    expect(outboundOrderUpdates).toBe(0);
  });

  it("keeps completed payment and webhook claim durable when post-settlement order notification fails", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Notification failure", currency: "PHP" });
    const branch = await db.createBranch({
      businessId: business.id, name: "QA Main", type: "store", isActive: true,
    });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Milk", sku: "MAIL",
      barcode: null, brand: null, unit: "pc", costMinor: 10, priceMinor: 100,
      taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 4 });
    const now = new Date();
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PREPAID",
      branchId: branch.id, customerId: null, contactName: "QA", email: "qa@example.test", phone: null,
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100,
      discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100,
      saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now,
      confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public", requestId: "notify-qa", createdAt: now, updatedAt: now,
    });
    await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId: product.id,
      name: product.name, sku: product.sku, barcode: null, unit: product.unit,
      qty: 1, priceMinor: 100, costMinor: 10, taxRateBps: null,
      discountMinor: 0, taxMinor: 0, lineTotalMinor: 100,
      bundleComponentsSnapshot: null, createdAt: now,
    });
    await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "hold", now);
    const sale = await new OrderSaleService(db).createSaleFromSubmittedOrder(business.id, "staff", "sale", order.id);
    const paymongo = new FakePayMongo();
    const checkout = await new SalesService(db, paymongo).startPayMongoCheckout(
      business.id, "staff", "checkout", sale.id, "card", "idempotent-qa", "https://nexpos.example",
    );
    const payload = {
      data: {
        id: "evt_notify_fail",
        type: "checkout_session.payment.paid",
        data: {
          id: checkout.checkoutSessionId,
          attributes: {
            reference_number: sale.id,
            metadata: { businessId: business.id, saleId: sale.id, method: "card" },
            payments: [{
              attributes: { status: "paid", amount: 100, currency: "PHP", source: { type: "card" } },
            }],
          },
        },
      },
    };
    const notifier = new OrderNotificationService(db, {
      async sendPasswordReset() {},
      async sendEmailVerification() {},
      async sendReceiptShare() {},
      async sendOrderUpdate() {},
    });
    let eventLockHeld = false;
    const originalWithLock = db.withLock.bind(db);
    vi.spyOn(db, "withLock").mockImplementation(async (key, fn) => {
      if (key !== "paymongo-webhook:evt_notify_fail") return originalWithLock(key, fn);
      return originalWithLock(key, async () => {
        eventLockHeld = true;
        try {
          return await fn();
        } finally {
          eventLockHeld = false;
        }
      });
    });
    let notificationLockState: boolean | null = null;
    const sendEvent = vi.spyOn(notifier, "sendEvent").mockImplementation(async () => {
      notificationLockState = eventLockHeld;
      throw new Error("TOKEN_ISSUER_UNAVAILABLE");
    });
    const webhook = new SalesPayMongoWebhookService(db, paymongo, new SalesStockService(db), notifier);
    const raw = JSON.stringify(payload);
    await expect(webhook.handle(raw, "valid", payload, "notify-1")).resolves.toEqual({ handled: true });
    expect(await db.findSaleById(sale.id, business.id)).toMatchObject({ status: "COMPLETED", paidMinor: 100 });
    expect(await db.findOrderById(order.id, business.id)).toMatchObject({ status: "CONFIRMED" });
    expect((await db.listPaymentsBySale(sale.id, business.id))).toEqual([
      expect.objectContaining({ status: "SUCCEEDED" }),
    ]);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(notificationLockState).toBe(false);
    await expect(webhook.handle(raw, "valid", payload, "notify-2")).resolves.toEqual({
      handled: true, deduplicated: true,
    });
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
  });

  it("rolls back a failed webhook status update and safely retries settlement exactly once", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Atomic settlement", currency: "PHP" });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Stock QA", sku: "ATOMIC",
      barcode: null, brand: null, unit: "pc", costMinor: 10, priceMinor: 100,
      taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: business.id, branchId: null, productId: product.id, qtyOnHand: 2 });
    const sale = await db.createSale({
      businessId: business.id, receiptNo: "TEST-ATOM-1", status: "PENDING_PAYMENT",
      subtotalMinor: 100, discountMinor: 0, taxMinor: 0, totalMinor: 100,
      paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
      notes: null, actorId: "staff", requestId: "sale", idempotencyKey: null,
      registerId: null, branchId: null, createdAt: new Date(),
    });
    await db.createSaleItem({
      businessId: business.id, saleId: sale.id, productId: product.id, name: product.name,
      unit: "pc", qty: 1, priceMinor: 100, costMinor: 10, taxRateBps: null,
      lineDiscountMinor: 0, lineTotalMinor: 100,
    });
    await db.createPayment({
      businessId: business.id, saleId: sale.id, method: "card", amountMinor: 100,
      status: "PENDING", providerRef: "cs_atomic", idempotencyKey: "qa-atomic-payment",
    });
    const payload = {
      data: {
        id: "evt_atomic_failure", type: "checkout_session.payment.paid",
        data: { id: "cs_atomic", attributes: {
          reference_number: sale.id,
          metadata: { businessId: business.id, saleId: sale.id, method: "card" },
          payments: [{ attributes: { status: "paid", amount: 100, currency: "PHP", source: { type: "card" } } }],
        } },
      },
    };
    const originalUpdate = db.updateWebhookEventStatus.bind(db);
    const updateStatus = vi.spyOn(db, "updateWebhookEventStatus")
      .mockRejectedValueOnce(new Error("INJECTED_STATUS_WRITE_FAILURE"))
      .mockImplementation(originalUpdate);
    const webhook = new SalesPayMongoWebhookService(db, new FakePayMongo(), new SalesStockService(db));
    const raw = JSON.stringify(payload);
    const completedCount = () => Number(
      renderMetrics().split("\n").find((line) => line.startsWith("pos_sales_completed_total "))?.split(" ")[1] ?? 0,
    );
    const metricBefore = completedCount();
    await expect(webhook.handle(raw, "valid", payload, "atomic-1"))
      .rejects.toThrow("INJECTED_STATUS_WRITE_FAILURE");
    expect(completedCount()).toBe(metricBefore);
    expect(await db.findWebhookEvent("paymongo", "evt_atomic_failure")).toBeNull();
    expect(await db.findSaleById(sale.id, business.id)).toMatchObject({ status: "PENDING_PAYMENT", paidMinor: 0 });
    expect(await db.listPaymentsBySale(sale.id, business.id)).toEqual([
      expect.objectContaining({ status: "PENDING" }),
    ]);
    expect((await db.findBalance(product.id, business.id, null))?.qtyOnHand).toBe(2);
    expect((await db.listMovements(product.id, business.id, null)).filter((row) => row.type === "sale")).toHaveLength(0);

    await expect(webhook.handle(raw, "valid", payload, "atomic-2")).resolves.toEqual({ handled: true });
    expect(completedCount()).toBe(metricBefore + 1);
    await expect(webhook.handle(raw, "valid", payload, "atomic-3"))
      .resolves.toEqual({ handled: true, deduplicated: true });
    expect(completedCount()).toBe(metricBefore + 1);
    const differentEvent = {
      data: { ...payload.data, id: "evt_atomic_second_event" },
    };
    await expect(webhook.handle(JSON.stringify(differentEvent), "valid", differentEvent, "atomic-4"))
      .resolves.toEqual({ handled: true });
    expect(completedCount()).toBe(metricBefore + 1);
    expect(await db.findWebhookEvent("paymongo", "evt_atomic_failure")).toMatchObject({ status: "processed" });
    expect(await db.findWebhookEvent("paymongo", "evt_atomic_second_event")).toMatchObject({ status: "processed" });
    expect(await db.findSaleById(sale.id, business.id)).toMatchObject({ status: "COMPLETED", paidMinor: 100 });
    expect((await db.findBalance(product.id, business.id, null))?.qtyOnHand).toBe(1);
    expect((await db.listMovements(product.id, business.id, null)).filter((row) => row.type === "sale")).toHaveLength(1);
    expect(updateStatus).toHaveBeenCalledTimes(3);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { OrderNotificationService } from "../orders/order-notification-service";
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
    const sales = new SalesService(db, new FakePayMongo());
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

    expect(await sales.handlePayMongoWebhook(raw, "valid", payload, "webhook-2"))
      .toEqual({ handled: true, deduplicated: true });
    expect(await db.listFulfillmentsByOrder(order.id, business.id)).toHaveLength(1);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
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
    const sendEvent = vi.spyOn(notifier, "sendEvent").mockRejectedValue(new Error("TOKEN_ISSUER_UNAVAILABLE"));
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
    await expect(webhook.handle(raw, "valid", payload, "notify-2")).resolves.toEqual({
      handled: true, deduplicated: true,
    });
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(1);
  });
});

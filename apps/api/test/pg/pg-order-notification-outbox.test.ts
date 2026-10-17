import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";
import { PgOrderNotificationOutbox, OrderNotificationOutboxWorker } from "../../src/orders/order-notification-outbox";
import { OrderNotificationService } from "../../src/orders/order-notification-service";
import { OrderService } from "../../src/orders/order-service";
import { ReservationService } from "../../src/orders/reservation-service";
import { FulfillmentService } from "../../src/orders/fulfillment-service";
import type { TransactionalEmailPort } from "../../src/email/email.service";
import type { DbPort } from "../../src/common/db.port";

async function createOrder(db: DbPort) {
  const business = await db.createBusiness({ name: "Outbox PG Shop", currency: "PHP" });
  const now = new Date();
  const order = await db.createOrder({
    businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId: null, customerId: null, contactName: "Customer", email: "customer@example.com", phone: null,
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100,
    discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100,
    saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now,
    confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public",
    requestId: "pg-outbox", createdAt: now, updatedAt: now,
  });
  return { business, order };
}

function emailSender(send: TransactionalEmailPort["sendOrderUpdate"]): TransactionalEmailPort {
  return {
    sendPasswordReset: async () => {}, sendEmailVerification: async () => {},
    sendReceiptShare: async () => {}, sendOrderUpdate: send,
  };
}

describe("PostgreSQL H5 order notification outbox (disposable database only)", () => {
  it("enqueues a real staff acceptance atomically instead of sending mail during the transaction", async () => {
    await withPg(async (db, ctx) => {
      const business = await db.createBusiness({ name: "Acceptance queue", currency: "PHP" });
      const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
      const product = await db.createProduct({
        businessId: business.id, categoryId: null, name: "Tea", sku: "TEA", barcode: null, brand: null,
        unit: "pc", costMinor: 10, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
        trackInventory: true, isActive: true, imageUrl: null,
      });
      await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 3 });
      const now = new Date();
      const order = await db.createOrder({
        businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
        branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
        deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100,
        discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100,
        saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now,
        confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public",
        requestId: "accept-queued", createdAt: now, updatedAt: now,
      });
      await db.createOrderLine({
        businessId: business.id, orderId: order.id, position: 0, productId: product.id,
        name: product.name, sku: product.sku, barcode: null, unit: product.unit, qty: 1,
        priceMinor: 100, costMinor: 10, taxRateBps: null, discountMinor: 0, taxMinor: 0,
        lineTotalMinor: 100, bundleComponentsSnapshot: null, createdAt: now,
      });
      await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "queue-reserve", now);
      const outbox = new PgOrderNotificationOutbox(ctx);
      let sends = 0;
      const notifications = new OrderNotificationService(db, emailSender(async () => { sends++; }), outbox);
      const service = new OrderService(db, notifications);
      const accepted = await service.acceptPayAtPickup(
        business.id, "staff", "accept-queue", order.id, order.version, "accept-idempotent", now,
      );
      expect(accepted.status).toBe("CONFIRMED");
      const [fulfillment] = await db.listFulfillmentsByOrder(order.id, business.id);
      expect(fulfillment).toBeDefined();
      const ready = await new FulfillmentService(db, notifications).transition(
        business.id, "staff", "ready-queue", order.id, fulfillment!.id, "READY",
        fulfillment!.version, "ready-idempotent",
      );
      expect(ready.status).toBe("READY");
      expect(sends).toBe(0);
      const jobs = await outbox.claimDue(new Date(now.getTime() + 1000), 10, 10_000);
      expect(jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: "CONFIRMED", businessId: business.id, orderId: order.id }),
        expect.objectContaining({ event: "READY", businessId: business.id, orderId: order.id }),
      ]));
      expect(jobs).toHaveLength(2);
      expect(JSON.stringify(jobs)).not.toContain("ana@example.com");
    });
  });

  it("requires an installed migration and persists tenant-scoped dedupe", async () => {
    await withPg(async (db, ctx) => {
      const { business, order } = await createOrder(db);
      const queue = new PgOrderNotificationOutbox(ctx);
      await queue.assertReady();
      const input = { businessId: business.id, orderId: order.id, event: "SUBMITTED", dedupeKey: "submit:1" };
      const first = await queue.enqueue(input);
      expect((await queue.enqueue(input)).id).toBe(first.id);
      await expect(queue.enqueue({ ...input, event: "CONFIRMED" })).rejects.toThrow("CONFLICT");
      await expect(queue.enqueue({ ...input, orderId: "order-other", dedupeKey: "different" })).rejects.toThrow();
    });
  });

  it("rolls back a queued job when the order transaction fails, then commits atomically", async () => {
    await withPg(async (db, ctx) => {
      const { business, order } = await createOrder(db);
      const queue = new PgOrderNotificationOutbox(ctx);
      const input = { businessId: business.id, orderId: order.id, event: "SUBMITTED", dedupeKey: "submit:tx" };
      await expect(db.withTransaction(async (tx) => {
        await tx.updateOrder(order.id, business.id, { contactName: "Changed" }, order.version);
        await queue.enqueue(input);
        throw new Error("ROLLBACK_SENTINEL");
      })).rejects.toThrow("ROLLBACK_SENTINEL");
      expect((await db.findOrderById(order.id, business.id))?.contactName).toBe("Customer");
      expect(await queue.claimDue(new Date(Date.now() + 100), 10, 10_000)).toEqual([]);
      await db.withTransaction(async (tx) => {
        await tx.updateOrder(order.id, business.id, { contactName: "Committed" }, order.version);
        await queue.enqueue(input);
      });
      expect((await db.findOrderById(order.id, business.id))?.contactName).toBe("Committed");
      expect(await queue.claimDue(new Date(Date.now() + 100), 10, 10_000)).toHaveLength(1);
    });
  });

  it("isolates concurrent claims and fences a stale worker after its lease expires", async () => {
    await withPg(async (db, ctx) => {
      const { business, order } = await createOrder(db);
      const queueA = new PgOrderNotificationOutbox(ctx);
      const queueB = new PgOrderNotificationOutbox(ctx);
      const now = new Date();
      await queueA.enqueue({ businessId: business.id, orderId: order.id, event: "CONFIRMED", dedupeKey: "accept:1" }, now);
      const [a, b] = await Promise.all([
        queueA.claimDue(now, 1, 10_000),
        queueB.claimDue(now, 1, 10_000),
      ]);
      expect(a.length + b.length).toBe(1);
      const first = (a[0] ?? b[0])!;
      const later = new Date(now.getTime() + 11_000);
      const [reclaimed] = await queueB.claimDue(later, 1, 10_000);
      expect(reclaimed?.id).toBe(first.id);
      expect(reclaimed?.leaseId).not.toBe(first.leaseId);
      expect(await queueA.markSent(first.id, first.leaseId!, later)).toBe(false);
      expect(await queueB.markSent(reclaimed!.id, reclaimed!.leaseId!, later)).toBe(true);
      expect(await queueA.claimDue(new Date(later.getTime() + 11_000), 1, 10_000)).toHaveLength(0);
    });
  });

  it("persists failures across worker recreation and cancels pending notifications for revoked orders", async () => {
    await withPg(async (db, ctx) => {
      const { business, order } = await createOrder(db);
      const store = new PgOrderNotificationOutbox(ctx);
      const now = new Date();
      await store.enqueue({ businessId: business.id, orderId: order.id, event: "CONFIRMED", dedupeKey: "accept:2" }, now);
      let fail = true;
      const delivered: string[] = [];
      const notifications = new OrderNotificationService(db, emailSender(async ({ token }) => {
        if (fail) throw new Error("SENSITIVE_PROVIDER_ERROR");
        delivered.push(token);
      }), store);
      const first = new OrderNotificationOutboxWorker(db, store, notifications);
      expect(await first.runOnce(now)).toMatchObject({ claimed: 1, retried: 1 });
      fail = false;
      const restarted = new OrderNotificationOutboxWorker(db, new PgOrderNotificationOutbox(ctx), notifications);
      expect(await restarted.runOnce(new Date(now.getTime() + 29_000))).toMatchObject({ claimed: 0 });
      expect(await restarted.runOnce(new Date(now.getTime() + 31_000))).toMatchObject({ claimed: 1, sent: 1 });
      expect(delivered).toHaveLength(1);
      await store.enqueue({ businessId: business.id, orderId: order.id, event: "READY", dedupeKey: "ready:3" }, now);
      await notifications.revoke(business.id, order.id);
      expect(await store.claimDue(new Date(now.getTime() + 31_000), 10, 10_000)).toHaveLength(0);
    });
  });
});

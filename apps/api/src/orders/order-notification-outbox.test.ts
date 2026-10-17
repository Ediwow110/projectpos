import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import type { TransactionalEmailPort } from "../email/email.service";
import { OrderAccessService } from "./order-access-service";
import { OrderNotificationService } from "./order-notification-service";
import {
  createMemoryOrderNotificationOutbox,
  OrderNotificationOutboxWorker,
  PgOrderNotificationOutbox,
} from "./order-notification-outbox";

async function fixture() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Outbox Shop", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const now = new Date("2026-10-18T00:00:00Z");
  const order = await db.createOrder({
    businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: null,
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100,
    discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100,
    saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now,
    confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public",
    requestId: "outbox", createdAt: now, updatedAt: now,
  });
  return { db, business, order };
}

function emailSender(send: TransactionalEmailPort["sendOrderUpdate"]): TransactionalEmailPort {
  return {
    sendPasswordReset: async () => {}, sendEmailVerification: async () => {},
    sendReceiptShare: async () => {}, sendOrderUpdate: send,
  };
}

describe("H5 durable order notification outbox", () => {
  it("deduplicates tenant-scoped enqueue keys without persisting PII or bearer tokens", async () => {
    const store = createMemoryOrderNotificationOutbox();
    const input = { businessId: "b1", orderId: "o1", event: "CONFIRMED", dedupeKey: "order:o1:1:CONFIRMED" };
    const one = await store.enqueue(input, new Date(1000));
    const two = await store.enqueue(input, new Date(2000));
    expect(two.id).toBe(one.id);
    expect((await store.enqueue({ ...input, businessId: "b2" }, new Date(2000))).id).not.toBe(one.id);
    expect(JSON.stringify(one)).not.toMatch(/@|tokenHash|bearer/i);
    await expect(store.enqueue({ ...input, event: "ana@example.com", dedupeKey: "bad" }))
      .rejects.toThrow("INVALID_OUTBOX_INPUT");
    await expect(store.enqueue({ ...input, dedupeKey: "Bearer token/secret" }))
      .rejects.toThrow("INVALID_OUTBOX_INPUT");
  });

  it("leases only one worker, rejects stale acknowledgments and reclaims after expiry", async () => {
    const store = createMemoryOrderNotificationOutbox();
    await store.enqueue({ businessId: "b", orderId: "o", event: "CONFIRMED", dedupeKey: "e1" }, new Date(0));
    const [first] = await store.claimDue(new Date(0), 10, 10_000);
    expect(first).toBeDefined();
    expect(first!.attempts).toBe(1);
    expect(await store.claimDue(new Date(100), 10, 10_000)).toHaveLength(0);
    const [replacement] = await store.claimDue(new Date(11_000), 10, 10_000);
    expect(replacement!.attempts).toBe(2);
    expect(await store.markSent(first!.id, first!.leaseId!, new Date(11_001))).toBe(false);
    expect(await store.markSent(replacement!.id, replacement!.leaseId!, new Date(11_001))).toBe(true);
    expect(await store.claimDue(new Date(50_000), 10, 10_000)).toHaveLength(0);
  });

  it("retries failed delivery after recreating the worker and preserves previously issued links", async () => {
    const { db, business, order } = await fixture();
    const store = createMemoryOrderNotificationOutbox();
    const oldLink = await new OrderAccessService(db).mintStatusToken(business.id, order.id);
    const delivered: string[] = [];
    let fail = true;
    const email = emailSender(async (input) => {
      if (fail) throw new Error("provider down");
      delivered.push(input.token);
    });
    await store.enqueue({
      businessId: business.id, orderId: order.id, event: "CONFIRMED", dedupeKey: "confirmed-v1",
    }, new Date(0));
    const firstWorker = new OrderNotificationOutboxWorker(
      db, store, new OrderNotificationService(db, email),
    );
    expect(await firstWorker.runOnce(new Date(0))).toEqual({ claimed: 1, sent: 0, retried: 1, dead: 0 });
    expect(await new OrderAccessService(db).authenticate(oldLink.token, "STATUS", order.id))
      .toMatchObject({ orderId: order.id });
    fail = false;
    const newWorker = new OrderNotificationOutboxWorker(db, store, new OrderNotificationService(db, email));
    expect(await newWorker.runOnce(new Date(29_999))).toMatchObject({ claimed: 0 });
    expect(await newWorker.runOnce(new Date(30_000))).toEqual({ claimed: 1, sent: 1, retried: 0, dead: 0 });
    expect(delivered).toHaveLength(1);
    expect(await new OrderAccessService(db).authenticate(delivered[0]!, "STATUS", order.id))
      .toMatchObject({ orderId: order.id });
  });

  it("stops after the configured retry limit without storing provider errors", async () => {
    const { db, business, order } = await fixture();
    const store = createMemoryOrderNotificationOutbox();
    const email = emailSender(async () => { throw new Error("secret-provider-failure"); });
    await store.enqueue({ businessId: business.id, orderId: order.id, event: "CONFIRMED", dedupeKey: "failed" }, new Date(0));
    const worker = new OrderNotificationOutboxWorker(db, store, new OrderNotificationService(db, email), 2);
    expect(await worker.runOnce(new Date(0))).toMatchObject({ retried: 1 });
    expect(await worker.runOnce(new Date(30_000))).toMatchObject({ dead: 1 });
    expect(await worker.runOnce(new Date(500_000))).toMatchObject({ claimed: 0 });
    const [job] = await store.listForTests();
    expect(job!.status).toBe("DEAD");
    expect(JSON.stringify(job)).not.toContain("secret-provider-failure");
  });

  it("cancels pending notifications when access is revoked", async () => {
    const store = createMemoryOrderNotificationOutbox();
    await store.enqueue({ businessId: "b", orderId: "o", event: "CONFIRMED", dedupeKey: "e" }, new Date(0));
    expect(await store.cancelOrder("b", "o", new Date(100))).toBe(1);
    expect(await store.claimDue(new Date(200), 10, 10_000)).toHaveLength(0);
  });

  it("uses PostgreSQL skip-locked claims and lease-checked acknowledgments", async () => {
    const statements: { sql: string; params: unknown[] }[] = [];
    const ctx = {
      async client() {
        return {
          async query(sql: string, params: unknown[]) {
            statements.push({ sql, params });
            return { rows: [], rowCount: 0 };
          },
          release() {},
        };
      },
      owns: () => true,
    };
    const pg = new PgOrderNotificationOutbox(ctx as never);
    expect(await pg.claimDue(new Date(0), 4, 10_000)).toEqual([]);
    expect(statements[0]!.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(statements[0]!.sql).toContain('"lockedUntil" <= $3');
    expect(statements[0]!.params[3]).toBe(4);
    expect(await pg.markSent("id", "old-lease", new Date(10))).toBe(false);
    expect(statements[1]!.sql).toContain('"leaseId"=$2');
    expect(statements[1]!.sql).toContain('"lockedUntil" > $3');
    expect(await pg.markFailed("id", "lease", new Date(20), 6)).toBe("STALE");
    expect(statements[2]!.sql).toContain("make_interval");
    expect(statements[2]!.sql).toContain('"attempts" - 1');
    expect(await pg.cancelOrder("tenant-b", "order-1", new Date(30))).toBe(0);
    expect(statements[3]!.sql).toContain('"businessId"=$1 AND "orderId"=$2');
  });

  it("polls on startup, never overlaps ticks, and stops cleanly", async () => {
    const { db } = await fixture();
    const store = createMemoryOrderNotificationOutbox();
    const worker = new OrderNotificationOutboxWorker(db, store, new OrderNotificationService(db, emailSender(async () => {})));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.spyOn(worker, "runOnce").mockImplementation(async () => {
      await gate;
      return { claimed: 0, sent: 0, retried: 0, dead: 0 };
    });
    vi.useFakeTimers();
    try {
      worker.start(1000);
      await vi.advanceTimersByTimeAsync(3100);
      expect(run).toHaveBeenCalledTimes(1);
      release();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
      expect(run).toHaveBeenCalledTimes(2);
      worker.stop();
      await vi.advanceTimersByTimeAsync(3000);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      release();
      worker.stop();
      vi.useRealTimers();
    }
  });
});

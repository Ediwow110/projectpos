import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";
import { ReservationService } from "../src/orders/reservation-service";
import { ShiftService } from "../src/shifts/nest/shift.service";

let app: INestApplication;
let db: DbPort;
let cookie: string;
let csrf: string;
let businessId: string;
let branchA: { id: string };
let branchB: { id: string };
let orderA: { id: string };
let orderB: { id: string };

function jar(header: unknown): string {
  const rows = Array.isArray(header) ? header : [String(header ?? "")];
  return rows.map((row) => String(row).split(";")[0]).join("; ");
}

async function createOrder(branchId: string, requestId: string) {
  const now = new Date();
  return db.createOrder({
    businessId, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
    taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
    version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
    actorId: "public:test", requestId, createdAt: now, updatedAt: now,
  });
}

beforeAll(async () => {
  app = await createTestApp();
  db = app.get("DbPort");
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-orders@example.com", password: "correct-horse-12", businessName: "Order Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  businessId = reg.body.business.id;
  branchA = await db.createBranch({ businessId, name: "Main", type: "store", isActive: true });
  branchB = await db.createBranch({ businessId, name: "Back", type: "store", isActive: true });
  orderA = await createOrder(branchA.id, "order-a");
  orderB = await createOrder(branchB.id, "order-b");
});

afterAll(async () => { await app.close(); });

describe("phase22 staff Order HTTP reads", () => {
  it("paginates a bounded list and rejects invalid limits", async () => {
    const first = await request(app.getHttpServer()).get("/api/v1/orders?limit=1").set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(first.body.items[0].paymentStatus).toBe("UNPAID");

    const second = await request(app.getHttpServer())
      .get("/api/v1/orders?limit=1&cursor=" + encodeURIComponent(first.body.nextCursor))
      .set("Cookie", cookie);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);

    const invalid = await request(app.getHttpServer()).get("/api/v1/orders?limit=101").set("Cookie", cookie);
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("VALIDATION");
  });

  it("enforces active-branch scope on list and detail", async () => {
    const scoped = await request(app.getHttpServer()).post("/api/v1/me/active-branch")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ branchId: branchA.id });
    expect(scoped.status).toBe(200);

    const list = await request(app.getHttpServer()).get("/api/v1/orders").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((row: { id: string }) => row.id)).toEqual([orderA.id]);

    const foreignFilter = await request(app.getHttpServer())
      .get("/api/v1/orders?branchId=" + encodeURIComponent(branchB.id)).set("Cookie", cookie);
    expect(foreignFilter.status).toBe(403);

    const foreignDetail = await request(app.getHttpServer()).get("/api/v1/orders/" + orderB.id).set("Cookie", cookie);
    expect(foreignDetail.status).toBe(404);
  });

  it("rejects unauthenticated staff Order reads", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/orders");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("accepts, readies, settles, and collects a pay-at-pickup order through staff routes", async () => {
    const product = await db.createProduct({
      businessId, categoryId: null, name: "Pickup unit", sku: "PICKUP-1", barcode: null, brand: null,
      unit: "pc", costMinor: 40, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
      trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId, branchId: branchA.id, productId: product.id, qtyOnHand: 5 });
    const order = await createOrder(branchA.id, "staff-flow");
    const now = new Date();
    await db.createOrderLine({
      businessId, orderId: order.id, position: 0, productId: product.id, name: product.name,
      sku: product.sku, barcode: null, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 40,
      taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100,
      bundleComponentsSnapshot: null, createdAt: now,
    });
    await new ReservationService(db).holdSubmittedOrder(businessId, order.id, "staff-flow-hold", now);

    const accept = await request(app.getHttpServer()).post(`/api/v1/orders/${order.id}/accept`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "staff-flow-accept")
      .send({ expectedVersion: order.version });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("CONFIRMED");

    const fulfillment = (await db.listFulfillmentsByOrder(order.id, businessId))[0]!;
    const ready = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/fulfillments/${fulfillment.id}/ready`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "staff-flow-ready")
      .send({ expectedVersion: fulfillment.version });
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("READY");

    const shifts = new ShiftService(db);
    const register = await shifts.createRegister(businessId, "staff", "staff-flow-register", { name: "Pickup Register", branchId: branchA.id }, "owner");
    await shifts.openShift(businessId, "staff", "staff-flow-shift", register.id, { openingFloatMinor: 0 }, "cashier");
    const collect = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/fulfillments/${fulfillment.id}/collect`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "staff-flow-collect")
      .send({
        expectedVersion: ready.body.version,
        payments: [{ method: "cash", amountMinor: 100 }],
        registerId: register.id,
        branchId: branchA.id,
      });
    expect(collect.status).toBe(200);
    expect(collect.body.status).toBe("COLLECTED");
    expect((await db.findOrderById(order.id, businessId))?.status).toBe("COMPLETED");
    expect((await db.listReservationsByOrder(order.id, businessId))[0]?.status).toBe("COMMITTED");
    expect((await db.findBalance(product.id, businessId, branchA.id))?.qtyOnHand).toBe(4);
  });

  it("links an exact-match customer and requires an audited owner override for mismatch", async () => {
    const exactOrder = await createOrder(branchA.id, "crm-exact");
    const exactCustomer = await db.createCustomer({
      businessId, name: "Ana", phone: null, email: "ana@example.com", address: null, notes: null, isActive: true,
    });
    const exact = await request(app.getHttpServer()).post(`/api/v1/orders/${exactOrder.id}/link-customer`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "crm-exact-key")
      .send({ expectedVersion: exactOrder.version, customerId: exactCustomer.id });
    expect(exact.status).toBe(200);
    expect(exact.body.customerId).toBe(exactCustomer.id);

    const mismatchOrder = await createOrder(branchA.id, "crm-mismatch");
    const mismatchCustomer = await db.createCustomer({
      businessId, name: "Other", phone: "09170000000", email: "other@example.com", address: null, notes: null, isActive: true,
    });
    const denied = await request(app.getHttpServer()).post(`/api/v1/orders/${mismatchOrder.id}/link-customer`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "crm-mismatch-denied")
      .send({ expectedVersion: mismatchOrder.version, customerId: mismatchCustomer.id });
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe("VALIDATION");

    const override = await request(app.getHttpServer()).post(`/api/v1/orders/${mismatchOrder.id}/link-customer`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "crm-mismatch-override")
      .send({
        expectedVersion: mismatchOrder.version,
        customerId: mismatchCustomer.id,
        overrideReason: "Verified customer identity at counter",
      });
    expect(override.status).toBe(200);
    expect(override.body.customerId).toBe(mismatchCustomer.id);
  });

  it("rotates and revokes status access idempotently", async () => {
    const order = await createOrder(branchA.id, "access-actions");
    const first = await request(app.getHttpServer()).post(`/api/v1/orders/${order.id}/access/resend`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "access-resend-key").send({});
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ sent: true, replayed: false });
    const replay = await request(app.getHttpServer()).post(`/api/v1/orders/${order.id}/access/resend`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "access-resend-key").send({});
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ sent: true, replayed: true });
    expect(await db.listActiveOrderAccessTokens(order.id, businessId, "STATUS", new Date())).toHaveLength(1);

    const revoke = await request(app.getHttpServer()).post(`/api/v1/orders/${order.id}/access/revoke`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "access-revoke-key").send({});
    expect(revoke.status).toBe(200);
    expect(revoke.body.revoked).toBe(1);
    expect(await db.listActiveOrderAccessTokens(order.id, businessId, "STATUS", new Date())).toHaveLength(0);
  });
});

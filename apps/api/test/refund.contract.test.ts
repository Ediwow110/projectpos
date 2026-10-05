import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

let app: INestApplication;
let cookie: string;
let csrf: string;
let productId: string;
let registerId: string;
let db: DbPort;
let businessId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

async function makeCompletedSale(key: string, qty: number, reg?: string): Promise<{ id: string; totalMinor: number }> {
  const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ lines: [{ productId, qty }], ...(reg ? { registerId: reg } : {}) });
  const done = await request(app.getHttpServer()).post("/api/v1/sales/complete")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", key)
    .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }], ...(reg ? { registerId: reg } : {}) });
  return { id: done.body.id, totalMinor: done.body.totalMinor };
}

beforeAll(async () => {
  app = await createTestApp();
  db = app.get("DbPort");
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-ref@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  businessId = reg.body.business.id;
  const created = await request(app.getHttpServer()).post("/api/v1/registers")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Counter 1" });
  registerId = created.body.id;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 50 });
  await request(app.getHttpServer()).post(`/api/v1/registers/${registerId}/open`)
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ registerId, openingFloatMinor: 0 });
});

afterAll(async () => { await app.close(); });

describe("phase6 refund HTTP contract", () => {
  it("completes and idempotently replays a cash exchange", async () => {
    const replacement = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Sprite Exchange", priceMinor: 3000, costMinor: 1200 });
    await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId: replacement.body.id, type: "opening_stock", qtyDelta: 20 });
    const sale = await makeCompletedSale("exchange-sale-1", 1, registerId);
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const body = {
      returns: [{ saleItemId: items[0].id, qty: 1 }],
      replacements: [{ productId: replacement.body.id, qty: 1 }],
      reason: "Wrong item",
    };
    const first = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/exchange`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "exchange-http-1")
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.exchange).toMatchObject({ returnMinor: 2500, replacementMinor: 3000, netMinor: 500, direction: "COLLECT" });
    expect(first.body.refund.saleId).toBe(sale.id);
    expect(first.body.replacementSale.status).toBe("COMPLETED");
    const detailAfterExchange = await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie);
    expect(detailAfterExchange.body.exchanges).toEqual([
      expect.objectContaining({ id: first.body.exchange.id, replacementSaleId: first.body.replacementSale.id, netMinor: 500 }),
    ]);
    const replacementDetail = await request(app.getHttpServer())
      .get(`/api/v1/sales/${first.body.replacementSale.id}`)
      .set("Cookie", cookie);
    expect(replacementDetail.status).toBe(200);
    expect(replacementDetail.body.exchangeOrigin).toEqual(
      expect.objectContaining({
        id: first.body.exchange.id,
        originalSaleId: sale.id,
        originalReceiptNo: detailAfterExchange.body.receiptNo,
        replacementSaleId: first.body.replacementSale.id,
      }),
    );

    const replay = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/exchange`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "exchange-http-1")
      .send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.exchange.id).toBe(first.body.exchange.id);
  });

  it("approves a full refund and marks the sale REFUNDED", async () => {
    const sale = await makeCompletedSale("ref-sale-1", 2, registerId);
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-1")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.sale.status).toBe("REFUNDED");
    const detail = await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie);
    expect(detail.body.refunds.length).toBe(1);
  });

  it("approves only the full remaining delivery charge through the existing refund endpoint", async () => {
    const sale = await makeCompletedSale("ref-delivery-sale", 1, registerId);
    await db.updateSale(sale.id, businessId, {
      deliveryFeeMinor: 1000,
      deliveryTaxMinor: 120,
      totalMinor: sale.totalMinor + 1120,
      paidMinor: sale.totalMinor + 1120,
    });
    await db.createPayment({
      businessId,
      saleId: sale.id,
      method: "card",
      amountMinor: 1120,
      status: "SUCCEEDED",
      providerRef: null,
      idempotencyKey: "ref-delivery-extra-tender",
    });
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-delivery-approve")
      .send({ saleId: sale.id, items: [], deliveryRefundMinor: 1120 });
    expect(res.status).toBe(201);
    expect(res.body.refund).toMatchObject({
      totalMinor: 1120,
      deliveryFeeRefundMinor: 1000,
      deliveryTaxRefundMinor: 120,
    });
    expect(res.body.sale.status).toBe("PARTIALLY_REFUNDED");

    const partial = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-delivery-partial-after")
      .send({ saleId: sale.id, items: [], deliveryRefundMinor: 500 });
    expect(partial.status).toBe(400);
    expect(partial.body.code).toBe("REFUND_EXCEEDS_LIMIT");
  });

  it("rejects over-quantity refunds with REFUND_EXCEEDS_LIMIT", async () => {
    const sale = await makeCompletedSale("ref-sale-2", 1);
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-2")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 5 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REFUND_EXCEEDS_LIMIT");
  });

  it("filters history by customer and exports CSV", async () => {
    const cust = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Refund Regular" });
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }], customerId: cust.body.id });
    await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-sale-3")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/sales?customerId=${cust.body.id}`).set("Cookie", cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.length).toBeGreaterThanOrEqual(1);
    const csv = await request(app.getHttpServer()).get("/api/v1/sales/export?format=csv")
      .set("Cookie", cookie);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.split("\n")[0]).toContain("id,receiptNo,status");
  });

  it("rejects unauthenticated refund approval", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/sales/s1/refund-approve")
      .set("Idempotency-Key", "ref-noauth")
      .send({ saleId: "s1", items: [{ saleItemId: "i1", qty: 1 }] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});

describe("phase6 refund edges", () => {
  it("rejects a refund request and returns the sale to COMPLETED", async () => {
    const sale = await makeCompletedSale("ref-sale-4", 1);
    const req = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-request`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-req-4")
      .send({ reason: "changed mind" });
    expect(req.status).toBe(201);
    const rej = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-reject`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ reason: "no defect found" });
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe("COMPLETED");
  });

  it("approves a requested refund end-to-end for the owner", async () => {
    const sale = await makeCompletedSale("ref-sale-5", 1);
    await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-request`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-req-5")
      .send({ reason: "changed mind" });
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-5")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.sale.status).toBe("REFUNDED");
  });

  it("rejects double approve with the same key as replay, not a duplicate", async () => {
    const sale = await makeCompletedSale("ref-sale-6", 1);
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const body = { saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 1 }] };
    const first = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-6")
      .send(body);
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-6")
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
  });

  it("rejects cash refunds with no open shift", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter Closed" });
    const opened = await request(app.getHttpServer()).post(`/api/v1/registers/${reg.body.id}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId: reg.body.id, openingFloatMinor: 0 });
    const sale = await makeCompletedSale("ref-sale-7", 1, reg.body.id);
    await request(app.getHttpServer()).post(`/api/v1/shifts/${opened.body.id}/close`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ countedCashMinor: 2500 });
    const items = (await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie)).body.items;
    const res = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "ref-approve-7")
      .send({ saleId: sale.id, items: [{ saleItemId: items[0].id, qty: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHIFT_NO_OPEN_SHIFT");
  });
});

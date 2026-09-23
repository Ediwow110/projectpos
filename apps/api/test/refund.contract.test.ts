import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let productId: string;
let registerId: string;

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
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-ref@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
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

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let productId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-sale@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 50 });
});

afterAll(async () => { await app.close(); });

describe("phase4 sales HTTP contract", () => {
  it("drafts and completes a cash sale end-to-end with receipt", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 2 }] });
    expect(draft.status).toBe(201);
    const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-0001")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(complete.status).toBe(201);
    expect(complete.body.status).toBe("COMPLETED");
    const receipt = await request(app.getHttpServer()).get(`/api/v1/receipts/${draft.body.id}`)
      .set("Cookie", cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.receiptNo).toBeTruthy();
  });

  it("replays the same idempotency key without a duplicate", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const first = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-replay")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-replay")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.id).toBe(first.body.id);
  });

  it("rejects split-total mismatch with PAYMENT_TOTAL_MISMATCH", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-mismatch")
      .send({ saleId: draft.body.id, payments: [{ method: "card", amountMinor: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PAYMENT_TOTAL_MISMATCH");
  });

  it("rejects unauthenticated sales read with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/sales");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});

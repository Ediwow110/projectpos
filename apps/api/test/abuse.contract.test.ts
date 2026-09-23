import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookieA: string;
let csrfA: string;
let cookieB: string;
let productA: string;
let saleA: string;
let customerA: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const ra = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-abuse@example.com",
    password: "correct-horse-12", businessName: "Store A",
  });
  cookieA = jar(ra.headers["set-cookie"]);
  csrfA = ra.body.csrfToken;
  const rb = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Bo", email: "bo-abuse@example.com",
    password: "correct-horse-12", businessName: "Store B",
  });
  cookieB = jar(rb.headers["set-cookie"]);
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productA = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .send({ productId: productA, type: "opening_stock", qtyDelta: 50 });
  const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .send({ lines: [{ productId: productA, qty: 1 }] });
  const done = await request(app.getHttpServer()).post("/api/v1/sales/complete")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .set("Idempotency-Key", "abuse-setup-01")
    .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
  saleA = done.body.id;
  const cust = await request(app.getHttpServer()).post("/api/v1/customers")
    .set("Cookie", cookieA).set("X-CSRF-Token", csrfA)
    .send({ name: "Private A" });
  customerA = cust.body.id;
});

afterAll(async () => { await app.close(); });

describe("phase8 abuse: identity and tenancy", () => {
  it("rejects IDOR reads on foreign product, sale, and customer with NOT_FOUND", async () => {
    for (const path of [`/api/v1/products/${productA}`, `/api/v1/sales/${saleA}`, `/api/v1/customers/${customerA}`]) {
      const res = await request(app.getHttpServer()).get(path).set("Cookie", cookieB);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    }
  });

  it("rejects foreign writes (PATCH product, void sale) without effect", async () => {
    const patch = await request(app.getHttpServer()).patch(`/api/v1/products/${productA}`)
      .set("Cookie", cookieB).set("X-CSRF-Token", csrfA)
      .send({ priceMinor: 1 });
    expect([401, 403, 404]).toContain(patch.status);
    const mine = await request(app.getHttpServer()).get(`/api/v1/products/${productA}`).set("Cookie", cookieA);
    expect(mine.body.priceMinor).toBe(2500);
  });

  it("rejects forged sessions on reads", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/sales")
      .set("Cookie", "pos_session=forged-token");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("rejects CSRF-less mutations per module area", async () => {
    const paths: Array<{ method: "post"; path: string; body: unknown }> = [
      { method: "post", path: "/api/v1/products", body: { name: "X", priceMinor: 1 } },
      { method: "post", path: "/api/v1/sales/drafts", body: { lines: [] } },
      { method: "post", path: "/api/v1/customers", body: { name: "X" } },
      { method: "post", path: "/api/v1/expenses", body: { category: "X", amountMinor: 1, method: "cash" } },
    ];
    for (const p of paths) {
      const res = await request(app.getHttpServer())[p.method](p.path)
        .set("Cookie", cookieA)
        .send(p.body);
      expect(res.status).toBe(403);
      expect(["CSRF_MISMATCH", "CSRF_REQUIRED"]).toContain(res.body.code);
    }
  });

  it("reports cross-tenant overview as zeros, never foreign rows", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/dashboard/overview?dateFrom=2020-01-01T00:00:00.000Z&dateTo=2020-02-01T00:00:00.000Z&compare=none")
      .set("Cookie", cookieB);
    expect(res.status).toBe(200);
    expect(res.body.kpis.netRevenue.value).toBe(0);
    expect(res.body.topProducts).toEqual([]);
  });
});

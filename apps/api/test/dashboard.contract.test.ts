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

// Rolling 30-day window: contract sales land on real-now, which must fall
// inside the queried range while staying under the 366-day cap.
const SINCE = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

async function makeSale(key: string, qty: number): Promise<void> {
  const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ lines: [{ productId, qty }] });
  await request(app.getHttpServer()).post("/api/v1/sales/complete")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", key)
    .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-dash@example.com",
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
  await makeSale("dash-key-01", 2);
  await makeSale("dash-key-02", 1);
});

afterAll(async () => { await app.close(); });

describe("phase7 dashboard HTTP contract", () => {
  it("returns overview KPIs with comparison and attention", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/overview?dateFrom=${SINCE}&compare=none`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.kpis.netRevenue.value).toBe(7500);
    expect(res.body.kpis.grossProfit.value).toBe(4500);
    expect(res.body.topProducts[0].qty).toBe(3);
    expect(res.body.generatedAt).toBeTruthy();
    expect(Array.isArray(res.body.attention)).toBe(true);
  });

  it("omits profit for cashier-role reads (unit: permission filter)", async () => {
    const { ReportingService } = await import("../src/reports/nest/reporting.service");
    const { createMemoryDb } = await import("../src/common/memory.db");
    const svc = new ReportingService(createMemoryDb());
    const out = await svc.getOverview("b1", { compare: "none" }, "cashier", []);
    expect(out.kpis.grossProfit).toBeUndefined();
  });

  it("serves sales series and product rankings", async () => {
    const sales = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales?dateFrom=${SINCE}&compare=none&granularity=day`)
      .set("Cookie", cookie);
    expect(sales.status).toBe(200);
    expect(sales.body.totals.netRevenue).toBe(7500);
    const products = await request(app.getHttpServer())
      .get(`/api/v1/reports/products?dateFrom=${SINCE}&compare=none&tab=top`)
      .set("Cookie", cookie);
    expect(products.body.rows[0]).toMatchObject({ qty: 3, revenue: 7500 });
  });

  it("rejects unauthenticated overview with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/dashboard/overview");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});

describe("phase7 reporting edges", () => {
  it("serves inventory, payments, cash, and customers views", async () => {
    for (const path of [
      "/api/v1/reports/inventory",
      `/api/v1/reports/payments?dateFrom=${SINCE}&compare=none`,
      `/api/v1/reports/cash?dateFrom=${SINCE}&compare=none`,
      `/api/v1/reports/customers?dateFrom=${SINCE}&compare=none`,
    ]) {
      const res = await request(app.getHttpServer()).get(path).set("Cookie", cookie);
      expect(res.status).toBe(200);
    }
    const inv = await request(app.getHttpServer()).get("/api/v1/reports/inventory").set("Cookie", cookie);
    expect(inv.body.healthy).toBe(1);
    const pay = await request(app.getHttpServer())
      .get(`/api/v1/reports/payments?dateFrom=${SINCE}&compare=none`).set("Cookie", cookie);
    expect(pay.body.byMethod).toEqual([{ method: "cash", total: 7500, count: 2 }]);
  });

  it("rejects over-wide ranges with VALIDATION", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/reports/sales?dateFrom=2020-01-01T00:00:00.000Z&dateTo=2026-09-23T00:00:00.000Z&compare=none")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("rejects unauthenticated cashiers view with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/reports/cashiers");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("serves the cashiers view to the owner", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reports/cashiers?dateFrom=${SINCE}&compare=none`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.actors[0]).toMatchObject({ orders: 2, sales: 7500 });
  });
});

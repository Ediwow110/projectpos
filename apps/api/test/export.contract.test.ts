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

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-export@example.com",
    password: "correct-horse-12", businessName: "Export Store",
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

function parseCsv(text: string): string[][] {
  return text.replace(/^\uFEFF/, "").trim().split("\n").map((line) => line.split(","));
}

describe("phase10 ledger export HTTP contract", () => {
  it("exports balanced journals that reconcile to the sales report", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 2 }] });
    const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "export-sale-1")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(complete.status).toBe(201);
    await request(app.getHttpServer()).post("/api/v1/expenses")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ category: "Supplies", amountMinor: 500, method: "cash" });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/exports/ledger.csv?format=csv&dateFrom=${SINCE}&compare=none`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const rows = parseCsv(res.text);
    expect(rows[0]).toEqual(["date", "type", "ref", "account", "debitMinor", "creditMinor", "memo"]);
    const data = rows.slice(1);
    const debit = data.reduce((s, r) => s + Number(r[4]), 0);
    const credit = data.reduce((s, r) => s + Number(r[5]), 0);
    expect(debit).toBe(credit);
    expect(debit).toBeGreaterThan(0);
    const revenue = data.filter((r) => r[1] === "sale" && r[3] === "4000");
    expect(revenue.reduce((s, r) => s + Number(r[5]), 0)).toBe(5000);
    const cogs = data.filter((r) => r[1] === "cogs" && r[3] === "5000");
    expect(cogs.reduce((s, r) => s + Number(r[4]), 0)).toBe(2000);
    const supplies = data.filter((r) => r[1] === "expense" && r[3] === "6000");
    expect(supplies.reduce((s, r) => s + Number(r[4]), 0)).toBe(500);
    const report = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales?compare=none&dateFrom=${SINCE}`)
      .set("Cookie", cookie);
    expect(report.body.totals.netRevenue).toBe(5000);
  });
  it("returns a header-only CSV for a business with no activity", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Quiet", email: "quiet-export@example.com",
      password: "correct-horse-12", businessName: "Quiet Export Store",
    });
    const quietCookie = jar(reg.headers["set-cookie"]);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/exports/ledger.csv?format=csv&dateFrom=${SINCE}`)
      .set("Cookie", quietCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.text.replace(/^\uFEFF/, "").trim().split("\n");
    expect(lines).toEqual(["date,type,ref,account,debitMinor,creditMinor,memo"]);
  });
  it("rejects non-csv formats and accepts the default date range", async () => {
    const bad = await request(app.getHttpServer()).get("/api/v1/exports/ledger.csv?format=xlsx")
      .set("Cookie", cookie);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION");
    const anon = await request(app.getHttpServer()).get("/api/v1/exports/ledger.csv?format=csv")
      .set("Cookie", cookie);
    expect(anon.status).toBe(200);
  });
});

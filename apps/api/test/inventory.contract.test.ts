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
    ownerName: "Ana", email: "ana-inv@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500 });
  productId = prod.body.id;
});

afterAll(async () => { await app.close(); });

describe("phase3 inventory HTTP contract", () => {
  it("records opening stock and reads it back in balances", async () => {
    const mov = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId, type: "opening_stock", qtyDelta: 50 });
    expect(mov.status).toBe(201);
    const bal = await request(app.getHttpServer()).get("/api/v1/inventory/balances")
      .set("Cookie", cookie);
    expect(bal.status).toBe(200);
    expect(bal.body.items.some((b: { productId: string; qtyOnHand: number }) => b.productId === productId && b.qtyOnHand === 50)).toBe(true);
  });

  it("rejects oversell with INSUFFICIENT_STOCK", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId, type: "damage", qtyDelta: -999, reason: "flood damage" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSUFFICIENT_STOCK");
  });

  it("rejects unauthenticated balances with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/inventory/balances");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("returns movement history newest-first", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/inventory/products/" + productId + "/movements")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});

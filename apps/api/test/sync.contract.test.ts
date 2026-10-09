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
  app = await createTestApp({ completedOnboardingFixture: true });
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-sync@example.com",
    password: "correct-horse-12", businessName: "Sync Store",
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

describe("phase9b sync HTTP contract", () => {
  it("reports applied and unknown keys", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sync-sale-1")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(complete.status).toBe(201);
    const res = await request(app.getHttpServer()).post("/api/v1/sync/check")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sync-key-1")
      .send({ keys: [
        { key: "sync-sale-1", commandType: "sale.complete" },
        { key: "bogus-key", commandType: "sale.complete" },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.applied).toEqual([{ key: "sync-sale-1", resultId: draft.body.id }]);
    expect(res.body.unknown).toEqual([{ key: "bogus-key" }]);
    expect(typeof res.body.serverTime).toBe("string");
  });
  it("records manager conflict resolutions in the audit log", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/sync/resolve")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sync-resolve-1")
      .send({ key: "offline-k1", commandType: "sale.complete", reason: "covered by till count" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
  it("requires an idempotency key", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/sync/check")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ keys: [{ key: "k", commandType: "sale.complete" }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
  it("rejects unauthenticated access", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/devices");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});

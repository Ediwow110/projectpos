import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let branchA: string;
let branchB: string;
let productId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-transfer@example.com",
    password: "correct-horse-12", businessName: "Transfer Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const a = await request(app.getHttpServer()).post("/api/v1/branches")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "North" });
  branchA = a.body.id;
  const b = await request(app.getHttpServer()).post("/api/v1/branches")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "South" });
  branchB = b.body.id;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "receive", qtyDelta: 10, branchId: branchA });
});

afterAll(async () => { await app.close(); });

describe("phase9a transfer HTTP contract", () => {
  it("full lifecycle over HTTP with status transitions and embedded lines", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/transfers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ fromBranchId: branchA, toBranchId: branchB, lines: [{ productId, qty: 4 }] });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    const id = created.body.id as string;
    const dispatched = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/dispatch`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-dispatch-1")
      .send({});
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.transfer.status).toBe("IN_TRANSIT");
    const received = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/receive`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-receive-1")
      .send({});
    expect(received.status).toBe(200);
    expect(received.body.transfer.status).toBe("RECEIVED");
    const detail = await request(app.getHttpServer()).get(`/api/v1/transfers/${id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ productId, qty: 4 })]),
    );
  });
  it("rejects double dispatch with TRANSFER_INVALID_STATE", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/transfers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ fromBranchId: branchA, toBranchId: branchB, lines: [{ productId, qty: 1 }] });
    const id = created.body.id as string;
    const first = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/dispatch`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-double-1")
      .send({});
    expect(first.status).toBe(200);
    const second = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/dispatch`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-double-2")
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("TRANSFER_INVALID_STATE");
  });
  it("rejects unauthenticated access", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/transfers");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});

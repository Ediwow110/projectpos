import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-cust@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase6 customer HTTP contract", () => {
  it("creates, searches, and reads a customer with history", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Ana Santos", phone: "09171234567" });
    expect(created.status).toBe(201);
    const list = await request(app.getHttpServer()).get("/api/v1/customers?q=santos")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/${created.body.id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.purchaseHistory).toEqual([]);
  });

  it("rejects duplicate phone with VALIDATION", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Bo", phone: "09171234567" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("rejects unauthenticated reads with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/customers");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("returns NOT_FOUND for another tenant's customer", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-cust@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const created = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Private" });
    const got = await request(app.getHttpServer()).get(`/api/v1/customers/${created.body.id}`)
      .set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });
});

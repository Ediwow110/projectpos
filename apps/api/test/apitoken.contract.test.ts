import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let secret: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-token@example.com",
    password: "correct-horse-12", businessName: "Token Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase10 public api tokens HTTP contract", () => {
  it("mints a token once and reads with its scope, cookieless", async () => {
    const minted = await request(app.getHttpServer()).post("/api/v1/apitokens")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "reader", scopes: ["sales:read"] });
    expect(minted.status).toBe(201);
    expect(minted.body.prefix).toMatch(/^pos_[0-9a-f]{8}$/);
    secret = minted.body.secret as string;
    expect(secret.startsWith(minted.body.prefix)).toBe(true);
    const list = await request(app.getHttpServer()).get("/api/v1/apitokens")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.items[0].prefix).toBe(minted.body.prefix);
    expect(list.body.items[0].secret).toBeUndefined();
    const read = await request(app.getHttpServer()).get("/api/v1/sales?limit=5")
      .set("Authorization", `Bearer ${secret}`);
    expect(read.status).toBe(200);
  });
  it("denies out-of-scope routes with FORBIDDEN", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/reports/sales?compare=none")
      .set("Authorization", `Bearer ${secret}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    const write = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Authorization", `Bearer ${secret}`)
      .send({ name: "Nope", priceMinor: 100 });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("FORBIDDEN");
  });
  it("rejects revoked and garbage tokens with 401", async () => {
    const listed = await request(app.getHttpServer()).get("/api/v1/apitokens")
      .set("Cookie", cookie);
    const id = listed.body.items[0].id as string;
    const revoked = await request(app.getHttpServer()).post(`/api/v1/apitokens/${id}/revoke`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(revoked.status).toBe(200);
    const dead = await request(app.getHttpServer()).get("/api/v1/sales?limit=5")
      .set("Authorization", `Bearer ${secret}`);
    expect(dead.status).toBe(401);
    const garbage = await request(app.getHttpServer()).get("/api/v1/sales?limit=5")
      .set("Authorization", "Bearer pos_deadbeef_deadbeefdeadbeefdeadbeef");
    expect(garbage.status).toBe(401);
  });
});

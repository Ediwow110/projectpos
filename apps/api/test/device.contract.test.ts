import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let email = "ana-device@example.com";
let password = "correct-horse-12";

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email, password, businessName: "Device Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase9b device HTTP contract", () => {
  it("enrolls and lists own devices", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/devices")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ label: "Till 1" });
    expect(created.status).toBe(201);
    expect(created.body.label).toBe("Till 1");
    expect(created.body.revokedAt).toBeNull();
    const list = await request(app.getHttpServer()).get("/api/v1/devices")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((d: { id: string }) => d.id)).toContain(created.body.id);
  });
  it("rejects blank labels and unauthenticated reads", async () => {
    const bad = await request(app.getHttpServer()).post("/api/v1/devices")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ label: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION");
    const res = await request(app.getHttpServer()).get("/api/v1/devices");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
  it("revokes devices and blocks revoked logins", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/devices")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ label: "Till 2" });
    const id = created.body.id as string;
    const bound = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ email, password, deviceId: id });
    expect(bound.status).toBe(201);
    const revoked = await request(app.getHttpServer()).post(`/api/v1/devices/${id}/revoke`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "dev-revoke-1")
      .send({});
    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedAt).not.toBeNull();
    const blocked = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ email, password, deviceId: id });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("FORBIDDEN");
    const plain = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ email, password });
    expect(plain.status).toBe(201);
  });
  it("returns NOT_FOUND for another tenant's device", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/devices")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ label: "Till 3" });
    const id = created.body.id as string;
    const reg2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-device@example.com",
      password: "correct-horse-12", businessName: "Other Device Store",
    });
    const other = jar(reg2.headers["set-cookie"]);
    const otherCsrf = reg2.body.csrfToken as string;
    const got = await request(app.getHttpServer()).post(`/api/v1/devices/${id}/revoke`)
      .set("Cookie", other).set("X-CSRF-Token", otherCsrf)
      .set("Idempotency-Key", "dev-revoke-2")
      .send({});
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });
});

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

describe("phase1 HTTP contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("registers an owner and sets a session cookie", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        ownerName: "Ana",
        email: "ana@example.com",
        password: "correct-horse-12",
        businessName: "Sari Store",
      });
    expect(res.status).toBe(201);
    expect(String(res.headers["set-cookie"] ?? "")).toContain("pos_session=");
    expect(res.body.business.currency).toBe("PHP");
  });
  it("rejects weak password with stable error code", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        ownerName: "Ana",
        email: "ana2@example.com",
        password: "short",
        businessName: "Sari Store",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_WEAK_PASSWORD");
    expect(typeof res.body.correlationId).toBe("string");
  });
  it("rejects unauthenticated me with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
  it("rejects login rate-limit breach with RATE_LIMITED", async () => {
    const agent = request(app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      await agent.post("/api/v1/auth/login").send({ email: "x@y.z", password: "wrong-password-1" });
    }
    const res = await agent
      .post("/api/v1/auth/login")
      .send({ email: "x@y.z", password: "wrong-password-1" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  });
});

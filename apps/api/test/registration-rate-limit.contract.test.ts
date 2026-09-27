import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

describe("registration abuse protection", () => {
  let app: INestApplication;
  let previousLimit: string | undefined;

  beforeAll(async () => {
    previousLimit = process.env["REGISTRATION_RATE_LIMIT"];
    process.env["REGISTRATION_RATE_LIMIT"] = "5";
    const { createTestApp } = await import("../src/app.module");
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    if (previousLimit === undefined) delete process.env["REGISTRATION_RATE_LIMIT"];
    else process.env["REGISTRATION_RATE_LIMIT"] = previousLimit;
  });

  it("keeps forwarded client IPs in separate registration buckets behind the trusted proxy", async () => {
    const agent = request(app.getHttpServer());
    for (let i = 0; i < 5; i += 1) {
      const res = await agent.post("/api/v1/auth/register")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({});
      expect(res.status).toBe(400);
    }

    const otherClient = await agent.post("/api/v1/auth/register")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({});
    expect(otherClient.status).toBe(400);
    expect(otherClient.body.code).toBe("VALIDATION");
  });

  it("rate-limits repeated registration attempts from one IP", async () => {
    const agent = request(app.getHttpServer());
    for (let i = 0; i < 5; i += 1) {
      const res = await agent.post("/api/v1/auth/register").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
    }

    const limited = await agent.post("/api/v1/auth/register").send({});
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
  });
});

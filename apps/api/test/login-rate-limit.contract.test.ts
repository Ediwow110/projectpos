import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

// LOGIN_RATE_LIMIT is read once when the auth controller module loads, so this
// file pins its own value before importing the app. Seven is deliberate: five
// would pass under the built-in production default too, so only an honoured
// override lets the seventh attempt through. That single assertion covers both
// "the login brake exists" and "the override is wired".
const TEST_LOGIN_LIMIT = 7;
const VALID_PAYLOAD = { email: "probe@example.com", password: "correct-horse-12" };

describe("login abuse protection", () => {
  let app: INestApplication;
  let previousLimit: string | undefined;

  beforeAll(async () => {
    previousLimit = process.env["LOGIN_RATE_LIMIT"];
    process.env["LOGIN_RATE_LIMIT"] = String(TEST_LOGIN_LIMIT);
    const { createTestApp } = await import("../src/app.module");
    app = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (previousLimit === undefined) delete process.env["LOGIN_RATE_LIMIT"];
    else process.env["LOGIN_RATE_LIMIT"] = previousLimit;
  }, 30_000);

  it("honours LOGIN_RATE_LIMIT and then refuses further attempts with 429 RATE_LIMITED", async () => {
    const agent = request(app.getHttpServer());
    // Unknown credentials: the request is still processed (and counted), so a
    // 401 here proves the limiter admitted the attempt rather than rejecting it.
    for (let i = 0; i < TEST_LOGIN_LIMIT; i += 1) {
      const res = await agent.post("/api/v1/auth/login")
        .set("X-Forwarded-For", "203.0.113.20")
        .send({ ...VALID_PAYLOAD, email: `probe-${i}@example.com` });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
    }

    const limited = await agent.post("/api/v1/auth/login")
      .set("X-Forwarded-For", "203.0.113.20")
      .send(VALID_PAYLOAD);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
  });

  it("keeps forwarded client IPs in separate login buckets behind the trusted proxy", async () => {
    const agent = request(app.getHttpServer());
    // A different source IP has its own budget, so a saturated neighbour never
    // locks out the rest of a shared-NAT store.
    const otherClient = await agent.post("/api/v1/auth/login")
      .set("X-Forwarded-For", "203.0.113.21")
      .send(VALID_PAYLOAD);
    expect(otherClient.status).toBe(401);
    expect(otherClient.body.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("counts a malformed payload against the limiter before validating it", async () => {
    const agent = request(app.getHttpServer());
    // The brake is applied ahead of schema validation, so an abuse burst of
    // shape-invalid bodies still exhausts the budget. That ordering is
    // deliberate: it stops a cheap malformed flood from probing the login
    // surface for free.
    const malformed = { email: "not-an-email", password: "" };
    for (let i = 0; i < TEST_LOGIN_LIMIT; i += 1) {
      const res = await agent.post("/api/v1/auth/login")
        .set("X-Forwarded-For", "203.0.113.22")
        .send(malformed);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
    }

    const limited = await agent.post("/api/v1/auth/login")
      .set("X-Forwarded-For", "203.0.113.22")
      .send(malformed);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
  });
});

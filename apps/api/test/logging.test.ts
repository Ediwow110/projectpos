import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import { toSafeLogContext } from "../src/common/log-context";

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => { await app.close(); });

describe("phase8 observability", () => {
  it("redacts sensitive keys from log contexts", () => {
    const out = toSafeLogContext({
      businessId: "b1",
      password: "secret",
      passwordHash: "hash",
      token: "tok",
      approvalToken: "mgr_secret",
      csrfToken: "csrf",
      message: "hello",
    });
    expect(out).toEqual({
      businessId: "b1",
      password: "[redacted]",
      passwordHash: "[redacted]",
      token: "[redacted]",
      approvalToken: "[redacted]",
      csrfToken: "[redacted]",
      message: "hello",
    });
  });

  it("echoes the request correlation id in error envelopes", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/sales").set("X-Request-Id", "probe-123");
    expect(res.status).toBe(401);
    expect(res.body.correlationId).toBe("probe-123");
  });
});

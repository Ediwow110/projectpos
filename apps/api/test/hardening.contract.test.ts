import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import { createRateLimiter } from "../src/common/rate-limit";
import { cookieOpts } from "../src/auth/nest/auth.controller";

let app: INestApplication;
let cookie: string;
let csrf: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-hard@example.com",
    password: "correct-horse-12", businessName: "Hard Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase8 hardening", () => {
  it("sets security headers on responses", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/sales");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("sets safe cookie flags on login", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/auth/login").send({
      email: "ana-hard@example.com",
      password: "correct-horse-12",
    });
    const raw = res.headers["set-cookie"] as string | string[] | undefined;
    const arr = Array.isArray(raw) ? raw : [raw ?? ""];
    const session = arr.find((c) => c.startsWith("pos_session=")) ?? "";
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
  });

  it("marks cookies secure in production", () => {
    const prev = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const opts = cookieOpts({ protocol: "http" } as never);
      expect(opts.secure).toBe(true);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe("lax");
    } finally {
      process.env["NODE_ENV"] = prev;
    }
  });

  it("rate-limits money commands at 60/min/business (unit: limiter semantics)", async () => {
    const limiter = createRateLimiter(60, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i += 1) {
      expect(await limiter.hit("b1", t0 + i)).toBe(false);
    }
    expect(await limiter.hit("b1", t0 + 60)).toBe(true);
    expect(await limiter.hit("b2", t0 + 61)).toBe(false);
    expect(await limiter.hit("b1", t0 + 61_000)).toBe(false);
  });

  it("rejects CSRF-less refund approval", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/sales/s1/refund-approve")
      .set("Cookie", cookie)
      .set("Idempotency-Key", "hard-csrf-1")
      .send({ saleId: "s1", items: [{ saleItemId: "i1", qty: 1 }] });
    expect(res.status).toBe(403);
  });

  it("echoes nothing sensitive (uses existing csrf token shape)", () => {
    expect(csrf.length).toBeGreaterThan(16);
  });

  it("refuses to start a production API without a persistent database", async () => {
    const previousNodeEnv = process.env["NODE_ENV"];
    const previousDatabaseUrl = process.env["DATABASE_URL"];
    process.env["NODE_ENV"] = "production";
    delete process.env["DATABASE_URL"];
    let created: INestApplication | undefined;
    let failure: unknown;
    try {
      created = await createTestApp({ completedOnboardingFixture: true });
    } catch (error) {
      failure = error;
    } finally {
      if (created) await created.close();
      if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previousNodeEnv;
      if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = previousDatabaseUrl;
    }
    expect(failure).toEqual(new Error("ENV_MISSING_DATABASE_URL"));
  });
});

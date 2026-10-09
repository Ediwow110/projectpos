import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";
import { defaultOnboardingState } from "../src/business/onboarding";

let app: INestApplication;
let cookie: string;
let csrf: string;
let secret: string;
let priorPlatformKey: string | undefined;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  priorPlatformKey = process.env["PLATFORM_API_KEY"];
  process.env["PLATFORM_API_KEY"] = "test-platform-key";
  app = await createTestApp({ completedOnboardingFixture: true });
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-token@example.com",
    password: "correct-horse-12", businessName: "Token Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  // PLAN.md §16.2: the public API is an Enterprise entitlement, so the token
  // business is upgraded before minting.
  const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie);
  await request(app.getHttpServer())
    .patch(`/api/v1/platform/businesses/${me.body.businessId}/plan`)
    .set("x-platform-key", "test-platform-key")
    .send({ planKey: "enterprise" })
    .expect(200);
});

afterAll(async () => {
  await app.close();
  if (priorPlatformKey === undefined) delete process.env["PLATFORM_API_KEY"];
  else process.env["PLATFORM_API_KEY"] = priorPlatformKey;
});

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
  it("blocks an existing bearer token and session when required setup becomes pending", async () => {
    const db = app.get<DbPort>("DbPort");
    const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie);
    const businessId = me.body.businessId as string;
    const settings = await db.getSettings(businessId);
    await db.saveSettings(businessId, { ...settings, onboarding: defaultOnboardingState() });
    try {
      const bearer = await request(app.getHttpServer()).get("/api/v1/sales?limit=5")
        .set("Authorization", `Bearer ${secret}`);
      expect(bearer.status).toBe(403);
      expect(bearer.body.code).toBe("ONBOARDING_REQUIRED");

      const session = await request(app.getHttpServer()).get("/api/v1/sales?limit=5")
        .set("Cookie", cookie);
      expect(session.status).toBe(403);
      expect(session.body.code).toBe("ONBOARDING_REQUIRED");

      const profile = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie);
      expect(profile.status).toBe(200);
      expect(profile.body.onboardingRequired).toBe(true);
    } finally {
      await db.saveSettings(businessId, settings);
    }
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
  it("stops honoring an existing token after a downgrade, with machine fields", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Downgrade Owner", email: "downgrade-token@example.com",
      password: "correct-horse-12", businessName: "Downgrade Store",
    });
    const downCookie = jar(reg.headers["set-cookie"]);
    const downCsrf = reg.body.csrfToken;
    const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", downCookie);
    await request(app.getHttpServer())
      .patch(`/api/v1/platform/businesses/${me.body.businessId}/plan`)
      .set("x-platform-key", "test-platform-key")
      .send({ planKey: "enterprise" })
      .expect(200);
    const minted = await request(app.getHttpServer()).post("/api/v1/apitokens")
      .set("Cookie", downCookie).set("X-CSRF-Token", downCsrf)
      .send({ name: "survivor", scopes: ["sales:read"] });
    const downSecret = minted.body.secret as string;
    await request(app.getHttpServer())
      .get("/api/v1/sales?limit=1")
      .set("Authorization", `Bearer ${downSecret}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/platform/businesses/${me.body.businessId}/plan`)
      .set("x-platform-key", "test-platform-key")
      .send({ planKey: "pro" })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get("/api/v1/sales?limit=1")
      .set("Authorization", `Bearer ${downSecret}`);
    expect(after.status).toBe(402);
    expect(after.body.code).toBe("PLAN_LIMIT");
    expect(after.body.fields).toEqual({ feature: ["api"], plan: ["pro"] });
  });
  it("manages a global flag through the platform key", async () => {
    const set = await request(app.getHttpServer()).patch("/api/v1/platform/flags")
      .set("x-platform-key", "test-platform-key")
      .send({ key: "reports", enabled: false });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ key: "reports", enabled: false });
    const denied = await request(app.getHttpServer()).patch("/api/v1/platform/flags")
      .send({ key: "reports", enabled: true });
    expect(denied.status).toBe(403);
  });
});

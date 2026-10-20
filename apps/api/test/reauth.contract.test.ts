import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

import { createTestApp } from "../src/app.module";

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

describe("sensitive-setting reauthentication", () => {
  let app: INestApplication;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T00:00:00.000Z"));
  app = await createTestApp({ completedOnboardingFixture: true });
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it("refreshes the session reauth window after confirming the password", async () => {
    const email = `reauth-${Date.now()}@example.com`;
    const password = "correct-horse-12";
    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Reauth Owner",
      email,
      password,
      businessName: "Reauth Store",
    });
    expect(reg.status).toBe(201);
    const cookie = jar(reg.headers["set-cookie"]);
    const csrf = reg.body.csrfToken as string;

    vi.setSystemTime(new Date("2026-09-26T00:16:00.000Z"));

    const stale = await request(app.getHttpServer())
      .patch("/api/v1/business/settings")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ taxName: "VAT" });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("AUTH_REAUTH_REQUIRED");

    const confirmed = await request(app.getHttpServer())
      .post("/api/v1/auth/confirm-password")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ password });
    expect(confirmed.status).toBe(201);

    const fresh = await request(app.getHttpServer())
      .patch("/api/v1/business/settings")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ taxName: "VAT" });
    expect(fresh.status).toBe(200);
  });
});

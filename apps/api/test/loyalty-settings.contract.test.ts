import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

let app: INestApplication;
let ownerCookie: string;
let ownerCsrf: string;
let cashierCookie: string;
let cashierCsrf: string;

function jar(headers: unknown): string {
  const values = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return values.map((header) => String(header).split(";")[0]).join("; ");
}

beforeAll(async () => {
  const { createTestApp } = await import("../src/app.module");
  app = await createTestApp({ completedOnboardingFixture: true });
  const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Loyalty Settings Owner",
    email: "loyalty-settings-owner@example.com",
    password: "correct-horse-12",
    businessName: "Loyalty Settings Store",
  });
  ownerCookie = jar(owner.headers["set-cookie"]);
  ownerCsrf = owner.body.csrfToken as string;
  const invitation = await request(app.getHttpServer()).post("/api/v1/memberships")
    .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
    .send({ name: "Loyalty Settings Cashier", email: "loyalty-settings-cashier@example.com", role: "cashier" });
  const cashier = await request(app.getHttpServer()).post("/api/v1/auth/login")
    .send({ email: "loyalty-settings-cashier@example.com", password: invitation.body.tempPassword });
  cashierCookie = jar(cashier.headers["set-cookie"]);
  cashierCsrf = cashier.body.csrfToken as string;
}, 30_000);

afterAll(async () => { if (app) await app.close(); });

describe("loyalty settings contract", () => {
  it("returns an explicit no-program state and persists the owner configuration", async () => {
    const empty = await request(app.getHttpServer()).get("/api/v1/loyalty/program").set("Cookie", ownerCookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toBeNull();

    const saved = await request(app.getHttpServer()).post("/api/v1/loyalty/program")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ enabled: true, earnAmountMinor: 100, earnPoints: 1, redeemPoints: 10, redeemValueMinor: 100, minimumRedeemPoints: 10 });
    expect([200, 201]).toContain(saved.status);
    expect(saved.body).toMatchObject({ enabled: true, earnAmountMinor: 100, earnPoints: 1, redeemPoints: 10, redeemValueMinor: 100, minimumRedeemPoints: 10, version: 1 });

    const loaded = await request(app.getHttpServer()).get("/api/v1/loyalty/program").set("Cookie", ownerCookie);
    expect(loaded.body).toMatchObject(saved.body);
  });

  it("keeps both read and write settings operations unavailable to cashiers", async () => {
    const read = await request(app.getHttpServer()).get("/api/v1/loyalty/program").set("Cookie", cashierCookie);
    expect(read.status).toBe(403);

    const write = await request(app.getHttpServer()).post("/api/v1/loyalty/program")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ enabled: false, earnAmountMinor: 100, earnPoints: 1, redeemPoints: 10, redeemValueMinor: 100, minimumRedeemPoints: null });
    expect(write.status).toBe(403);
  });
});

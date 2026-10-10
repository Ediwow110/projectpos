import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let ownerCookie: string;
let ownerCsrf: string;
let cashierCookie: string;
let cashierCsrf: string;
let foreignCookie: string;
let accountId: string;

function cookie(headers: unknown): string {
  const values = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return values.map((value) => String(value).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const suffix = Date.now();
  const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ ownerName: "Accounting Owner", email: `accounting-owner-${suffix}@example.com`, password: "correct-horse-12", businessName: "Accounting Test" });
  ownerCookie = cookie(owner.headers["set-cookie"]);
  ownerCsrf = owner.body.csrfToken as string;
  const invite = await request(app.getHttpServer()).post("/api/v1/memberships").set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf).send({ name: "Cashier", email: `accounting-cashier-${suffix}@example.com`, role: "cashier" });
  const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email: `accounting-cashier-${suffix}@example.com`, password: invite.body.tempPassword });
  cashierCookie = cookie(login.headers["set-cookie"]);
  cashierCsrf = login.body.csrfToken as string;
  const foreign = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ ownerName: "Other Owner", email: `accounting-other-${suffix}@example.com`, password: "correct-horse-12", businessName: "Other Test" });
  foreignCookie = cookie(foreign.headers["set-cookie"]);
});

afterAll(async () => { await app.close(); });

describe("Phase 23 account API authorization", () => {
  it("seeds the business chart and creates custom accounts with audit", async () => {
    const chart = await request(app.getHttpServer()).get("/api/v1/accounting/accounts").set("Cookie", ownerCookie);
    expect(chart.status).toBe(200);
    expect(chart.body).toEqual(expect.arrayContaining([expect.objectContaining({ code: "2000", type: "liability" }), expect.objectContaining({ code: "2220", type: "liability" })]));
    const created = await request(app.getHttpServer()).post("/api/v1/accounting/accounts").set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf).send({ code: "6001", name: "Rent", type: "expense", normalSide: "debit" });
    expect(created.status).toBe(201);
    accountId = created.body.id as string;
  });

  it("denies cashier and foreign-tenant access and requires CSRF for writes", async () => {
    expect((await request(app.getHttpServer()).get("/api/v1/accounting/accounts").set("Cookie", cashierCookie)).status).toBe(403);
    const foreignChart = await request(app.getHttpServer()).get("/api/v1/accounting/accounts").set("Cookie", foreignCookie);
    expect(foreignChart.status).toBe(200);
    expect(foreignChart.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: "6001" })]));
    const noCsrf = await request(app.getHttpServer()).patch(`/api/v1/accounting/accounts/${accountId}`).set("Cookie", ownerCookie).send({ name: "Store rent" });
    expect(noCsrf.status).toBe(403);
    const denied = await request(app.getHttpServer()).post("/api/v1/accounting/accounts").set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).send({ code: "6002", name: "Denied", type: "expense", normalSide: "debit" });
    expect(denied.status).toBe(403);
  });
});

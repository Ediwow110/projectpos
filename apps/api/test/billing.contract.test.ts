import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let businessId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  process.env["PLATFORM_API_KEY"] = "test-platform-key";
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-billing@example.com",
    password: "correct-horse-12", businessName: "Billing Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  const me = await request(app.getHttpServer()).get("/api/v1/business")
    .set("Cookie", cookie);
  businessId = me.body.id;
});

afterAll(async () => { await app.close(); });

describe("phase10 billing HTTP contract", () => {
  it("shows the pro trial subscription with usage", async () => {
    const sub = await request(app.getHttpServer()).get("/api/v1/billing/subscription")
      .set("Cookie", cookie);
    expect(sub.status).toBe(200);
    expect(sub.body.planKey).toBe("pro");
    expect(sub.body.status).toBe("trialing");
    expect(sub.body.usage.products.limit).toBe(20000);
  });
  it("lists invoices, empty then platform-issued", async () => {
    const empty = await request(app.getHttpServer()).get("/api/v1/billing/invoices")
      .set("Cookie", cookie);
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);
    const issued = await request(app.getHttpServer()).post("/api/v1/platform/invoices/issue")
      .set("x-platform-key", "test-platform-key")
      .send({ businessId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" });
    expect(issued.status).toBe(201);
    expect(issued.body.amountMinor).toBe(149000);
    const list = await request(app.getHttpServer()).get("/api/v1/billing/invoices")
      .set("Cookie", cookie);
    expect(list.body.items.length).toBe(1);
    expect(list.body.items[0].status).toBe("open");
  });
  it("rejects platform access without the key and cross-tenant reads", async () => {
    const noKey = await request(app.getHttpServer()).post("/api/v1/platform/invoices/issue")
      .send({ businessId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" });
    expect(noKey.status).toBe(403);
    const reg2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-billing@example.com",
      password: "correct-horse-12", businessName: "Other Billing Store",
    });
    const other = jar(reg2.headers["set-cookie"]);
    const otherInvoices = await request(app.getHttpServer()).get("/api/v1/billing/invoices")
      .set("Cookie", other);
    expect(otherInvoices.status).toBe(200);
    expect(otherInvoices.body.items).toEqual([]);
  });

  it("allows only one concurrent platform mutation per support grant", async () => {
    const minted = await request(app.getHttpServer()).post("/api/v1/platform/grants")
      .set("x-platform-key", "test-platform-key")
      .send({
        purpose: "phase e concurrent support check",
        ttlMinutes: 30,
        actorId: "phase-e-auditor",
    });
    expect(minted.status).toBe(201);
    const token = minted.body.token as string;
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).patch("/api/v1/platform/flags")
        .set("x-support-grant", token)
        .send({ key: "phase-e-grant-race-a", enabled: true }),
      request(app.getHttpServer()).patch("/api/v1/platform/flags")
        .set("x-support-grant", token)
        .send({ key: "phase-e-grant-race-b", enabled: true }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 403]);
  });
});

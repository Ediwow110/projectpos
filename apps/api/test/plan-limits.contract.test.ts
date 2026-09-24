import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

// Plan §4 sequencing note: the platform plan-change endpoint lands in
// Task 5, so HTTP Free-path coverage lives there. This file proves the
// grandfathered path over HTTP (unlimited default) and the Free-cap block
// at the service level.
let app: INestApplication;
let cookie: string;
let csrf: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-limits@example.com",
    password: "correct-horse-12", businessName: "Limits Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase10 plan limits HTTP contract", () => {
  it("lets grandfathered businesses create freely", async () => {
    const prod = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Widget", priceMinor: 100 });
    expect(prod.status).toBe(201);
    const reg = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter 1" });
    expect(reg.status).toBe(201);
    const branch = await request(app.getHttpServer()).post("/api/v1/branches")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "North" });
    // Fresh registrations trial Pro, and branches are Enterprise-only per §16.2.
    expect(branch.status).toBe(402);
    expect(branch.body.code).toBe("PLAN_LIMIT");
    const reports = await request(app.getHttpServer()).get("/api/v1/reports/sales?compare=none")
      .set("Cookie", cookie);
    expect(reports.status).toBe(200);
  });
  it("blocks the 101st product on a free plan at the service level", async () => {
    const { createMemoryDb } = await import("../src/common/memory.db");
    const { CatalogService } = await import("../src/catalog/nest/catalog.service");
    const db = createMemoryDb();
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({ businessId: "b1", planId: free.id, status: "active", trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z") });
    const svc = new CatalogService(db);
    for (let i = 0; i < 100; i++) {
      await svc.createProduct("b1", "u1", "r1", { name: `P${i}`, priceMinor: 100 });
    }
    await expect(svc.createProduct("b1", "u1", "r1", { name: "P101", priceMinor: 100 })).rejects.toThrow("PLAN_LIMIT");
  });
});

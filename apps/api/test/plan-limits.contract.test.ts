import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

// Plan §16.2: entitlements are enforced server-side, never only hidden UI.
// This file proves the grandfathered path over HTTP (unlimited default), the
// Free-cap block, the machine-readable 402 envelope, that every customer and
// expense entry point is gated (not just list/create), and that the public API
// stays Enterprise-only with a usable catalog:write scope.
let app: INestApplication;
let cookie: string;
let csrf: string;
let priorPlatformKey: string | undefined;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  priorPlatformKey = process.env["PLATFORM_API_KEY"];
  process.env["PLATFORM_API_KEY"] = "test-platform-key";
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-limits@example.com",
    password: "correct-horse-12", businessName: "Limits Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => {
  await app.close();
  if (priorPlatformKey === undefined) delete process.env["PLATFORM_API_KEY"];
  else process.env["PLATFORM_API_KEY"] = priorPlatformKey;
});

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
  it("returns machine fields with the 402 plan-limit envelope", async () => {
    const branch = await request(app.getHttpServer()).post("/api/v1/branches")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "North" });
    expect(branch.status).toBe(402);
    expect(branch.body.code).toBe("PLAN_LIMIT");
    expect(branch.body.fields).toEqual({ limit: ["0"], used: ["0"], plan: ["pro"], resource: ["branches"] });
  });
  it("gates customer reads and writes for free tenants", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Free Owner", email: "free-caps@example.com",
      password: "correct-horse-12", businessName: "Free Caps Store",
    });
    const freeCookie = jar(reg.headers["set-cookie"]);
    const freeCsrf = reg.body.csrfToken;
    const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", freeCookie);
    const businessId = me.body.businessId as string;

    const customer = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", freeCookie).set("X-CSRF-Token", freeCsrf)
      .send({ name: "Before Downgrade" });
    expect(customer.status).toBe(201);
    const customerId = customer.body.id as string;

    const down = await request(app.getHttpServer())
      .patch(`/api/v1/platform/businesses/${businessId}/plan`)
      .set("x-platform-key", "test-platform-key")
      .send({ planKey: "free" });
    expect(down.status).toBe(200);

    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/${customerId}`).set("Cookie", freeCookie);
    expect(detail.status).toBe(402);
    expect(detail.body.code).toBe("PLAN_LIMIT");
    const update = await request(app.getHttpServer()).patch(`/api/v1/customers/${customerId}`)
      .set("Cookie", freeCookie).set("X-CSRF-Token", freeCsrf).send({ name: "Renamed" });
    expect(update.status).toBe(402);
    const createExpense = await request(app.getHttpServer()).post("/api/v1/expenses")
      .set("Cookie", freeCookie).set("X-CSRF-Token", freeCsrf)
      .send({ category: "misc", amountMinor: 100, method: "cash", expenseDate: "2026-09-24" });
    expect(createExpense.status).toBe(402);
  });
  it("gates expense detail and void for free tenants", async () => {
    const { createMemoryDb } = await import("../src/common/memory.db");
    const { ExpenseService } = await import("../src/expenses/nest/expense.service");
    const { BillingService } = await import("../src/billing/nest/billing.service");
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expense Store", currency: "PHP" });
    const pro = (await db.findPlanByKey("pro"))!;
    await db.upsertSubscription({ businessId: business.id, planId: pro.id, status: "active", trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z") });
    const svc = new ExpenseService(db);
    const expense = await svc.createExpense(business.id, "u1", "r1", {
      category: "misc", amountMinor: 100, method: "cash", expenseDate: "2026-09-24",
    });
    await new BillingService(db).changePlan(business.id, "platform", "r2", "free");
    await expect(svc.getExpense(business.id, expense.id)).rejects.toThrow("PLAN_LIMIT");
    await expect(
      svc.voidExpense(business.id, "u1", "r3", expense.id, "duplicate entry", "manager"),
    ).rejects.toThrow("PLAN_LIMIT");
  });
  it("gates every receipt setting key, not just receipt.*", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Receipt Owner", email: "receipt-caps@example.com",
      password: "correct-horse-12", businessName: "Receipt Caps Store",
    });
    const receiptCookie = jar(reg.headers["set-cookie"]);
    const receiptCsrf = reg.body.csrfToken;
    const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", receiptCookie);
    await request(app.getHttpServer())
      .patch(`/api/v1/platform/businesses/${me.body.businessId}/plan`)
      .set("x-platform-key", "test-platform-key")
      .send({ planKey: "free" })
      .expect(200);

    for (const body of [{ receiptHeader: "Thanks!" }, { receiptFooter: "Come again" }]) {
      const res = await request(app.getHttpServer()).patch("/api/v1/business/settings")
        .set("Cookie", receiptCookie).set("X-CSRF-Token", receiptCsrf)
        .send(body);
      expect(res.status).toBe(402);
      expect(res.body.code).toBe("PLAN_LIMIT");
      expect(res.body.fields.feature).toEqual(["receipt_customization"]);
    }
    const settings = await request(app.getHttpServer()).get("/api/v1/business")
      .set("Cookie", receiptCookie);
    expect(settings.body.settings.receiptHeader).toBeUndefined();
    expect(settings.body.settings.receiptFooter).toBeUndefined();
    // Non-receipt settings stay available on Free.
    const allowed = await request(app.getHttpServer()).patch("/api/v1/business/settings")
      .set("Cookie", receiptCookie).set("X-CSRF-Token", receiptCsrf)
      .send({ taxName: "VAT" });
    expect(allowed.status).toBe(200);
  });
  it("keeps the public API enterprise-only and catalog:write usable", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "API Owner", email: "api-caps@example.com",
      password: "correct-horse-12", businessName: "API Caps Store",
    });
    const apiCookie = jar(reg.headers["set-cookie"]);
    const apiCsrf = reg.body.csrfToken;
    const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", apiCookie);
    const businessId = me.body.businessId as string;

    const blocked = await request(app.getHttpServer()).post("/api/v1/apitokens")
      .set("Cookie", apiCookie).set("X-CSRF-Token", apiCsrf)
      .send({ name: "reader", scopes: ["sales:read"] });
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe("PLAN_LIMIT");

    await request(app.getHttpServer())
      .patch(`/api/v1/platform/businesses/${businessId}/plan`)
      .set("x-platform-key", "test-platform-key")
      .send({ planKey: "enterprise" })
      .expect(200);

    const minted = await request(app.getHttpServer()).post("/api/v1/apitokens")
      .set("Cookie", apiCookie).set("X-CSRF-Token", apiCsrf)
      .send({ name: "writer", scopes: ["catalog:write"] });
    expect(minted.status).toBe(201);
    const writerSecret = minted.body.secret as string;

    const written = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Authorization", `Bearer ${writerSecret}`)
      .send({ name: "Via API", priceMinor: 100 });
    expect(written.status).toBe(201);

    const readOnly = await request(app.getHttpServer()).post("/api/v1/apitokens")
      .set("Cookie", apiCookie).set("X-CSRF-Token", apiCsrf)
      .send({ name: "reader", scopes: ["catalog:read"] });
    const readOnlySecret = readOnly.body.secret as string;
    const denied = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Authorization", `Bearer ${readOnlySecret}`)
      .send({ name: "Denied", priceMinor: 100 });
    expect(denied.status).toBe(403);
  });
});

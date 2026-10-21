import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

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
    ownerName: "Ana", email: "ana-exp@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase6 expense HTTP contract", () => {
  it("records and voids an expense", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/expenses")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ category: "Ice", amountMinor: 500, method: "cash" });
    expect(created.status).toBe(201);
    const list = await request(app.getHttpServer()).get("/api/v1/expenses?category=Ice")
      .set("Cookie", cookie);
    expect(list.body.total).toBe(1);
    const voided = await request(app.getHttpServer()).post(`/api/v1/expenses/${created.body.id}/void`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ reason: "duplicate entry" });
    expect(voided.status).toBe(200);
    expect(voided.body.expense.voidedAt).not.toBeNull();
  });

  it("exports CSV with export gate", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/expenses/export?format=csv")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split("\n")[0]).toContain("id,category,amountMinor");
  });

  it("rejects bad method with VALIDATION", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/expenses")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ category: "Ice", amountMinor: 100, method: "barter" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns NOT_FOUND when another tenant tries to void an expense", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/expenses")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ category: "Ice", amountMinor: 700, method: "cash" });
    expect(created.status).toBe(201);

    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Other Owner",
      email: `expense-other-${Date.now()}@example.com`,
      password: "correct-horse-12",
      businessName: "Other Expense Store",
    });
    const otherCookie = jar(reg.headers["set-cookie"]);
    const otherCsrf = reg.body.csrfToken as string;

    const attempt = await request(app.getHttpServer()).post(`/api/v1/expenses/${created.body.id}/void`)
      .set("Cookie", otherCookie).set("X-CSRF-Token", otherCsrf)
      .send({ reason: "cross tenant attempt" });

    expect(attempt.status).toBe(404);
    expect(attempt.body.code).toBe("NOT_FOUND");
  });
});

/**
 * The export endpoint must honour the filters it advertises: category, method,
 * dateFrom, dateTo and voided mirror ExpenseService.listExpenses' real option
 * shapes (strings passed to Date parsing, voided as the "all" | "active" |
 * "voided" enum). Invalid values are 4xx VALIDATION errors, never an empty
 * CSV, and a filter that still matches more than the stated 1,000-row ceiling
 * carries a truncation notice line, the way the ledger export does.
 */
describe("expenses export filter HTTP contract", () => {
  const EXPORT_ROW_LIMIT = 1000;

  async function registerBusiness(email: string, businessName: string): Promise<{ cookie: string; businessId: string }> {
    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Export Owner", email,
      password: "correct-horse-12", businessName,
    });
    return { cookie: jar(reg.headers["set-cookie"]), businessId: reg.body.business.id as string };
  }

  function seedExpense(
    db: { createExpense(input: Record<string, unknown>): Promise<{ id: string }> },
    businessId: string,
    input: { category: string; method?: string; expenseDate?: Date; voidedAt?: Date | null },
  ): Promise<{ id: string }> {
    return db.createExpense({
      businessId,
      category: input.category,
      amountMinor: 1000,
      description: null,
      method: input.method ?? "cash",
      shiftId: null,
      branchId: null,
      expenseDate: input.expenseDate ?? new Date(),
      actorId: "u1",
      requestId: `expense-export-seed-${Math.random().toString(36).slice(2)}`,
      attachmentUrl: null,
      voidedAt: input.voidedAt ?? null,
      voidReason: input.voidedAt ? "duplicate entry" : null,
      cashAdjusted: true,
    });
  }

  function exportLines(text: string): string[] {
    return text.replace(/^\uFEFF/, "").trim().split("\n");
  }

  it("exports only the expenses matching the category filter", async () => {
    const biz = await registerBusiness("export-filter-category@example.com", "Category Export Store");
    const db = app.get("DbPort");
    await seedExpense(db, biz.businessId, { category: "Beans", method: "cash" });
    await seedExpense(db, biz.businessId, { category: "Rice", method: "card" });

    const res = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&category=Beans")
      .set("Cookie", biz.cookie);
    expect(res.status).toBe(200);
    const rows = exportLines(res.text).slice(1).map((line) => line.split(","));
    expect(rows.length).toBe(1);
    expect(rows[0]?.[1]).toBe("Beans");
  });

  it("exports only the expenses matching the method filter", async () => {
    const biz = await registerBusiness("export-filter-method@example.com", "Method Export Store");
    const db = app.get("DbPort");
    await seedExpense(db, biz.businessId, { category: "Fuel", method: "cash" });
    await seedExpense(db, biz.businessId, { category: "Fuel", method: "card" });

    const res = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&method=card")
      .set("Cookie", biz.cookie);
    expect(res.status).toBe(200);
    const rows = exportLines(res.text).slice(1).map((line) => line.split(","));
    expect(rows.length).toBe(1);
    expect(rows[0]?.[1]).toBe("Fuel");
    expect(rows[0]?.[3]).toBe("card");
  });

  it("exports only expenses inside the dateFrom/dateTo range", async () => {
    const biz = await registerBusiness("export-filter-dates@example.com", "Dated Export Store");
    const db = app.get("DbPort");
    const jan = await seedExpense(db, biz.businessId, { category: "Dated", expenseDate: new Date("2020-01-15T00:00:00.000Z") });
    const mar = await seedExpense(db, biz.businessId, { category: "Dated", expenseDate: new Date("2020-03-15T00:00:00.000Z") });
    const jun = await seedExpense(db, biz.businessId, { category: "Dated", expenseDate: new Date("2020-06-15T00:00:00.000Z") });

    const res = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv"
        + `&dateFrom=${encodeURIComponent("2020-02-01T00:00:00.000Z")}`
        + `&dateTo=${encodeURIComponent("2020-04-01T00:00:00.000Z")}`)
      .set("Cookie", biz.cookie);
    expect(res.status).toBe(200);
    const rows = exportLines(res.text).slice(1).map((line) => line.split(","));
    expect(rows.length).toBe(1);
    expect(rows[0]?.[0]).toBe(mar.id);
    expect(rows[0]?.[4]).toBe("2020-03-15T00:00:00.000Z");
    expect(rows.some((r) => r[0] === jan.id || r[0] === jun.id)).toBe(false);
  });

  it("excludes voided rows for voided=active, returns only voided rows for voided=voided, both for voided=all", async () => {
    const biz = await registerBusiness("export-filter-voided@example.com", "Voided Export Store");
    const db = app.get("DbPort");
    const active = await seedExpense(db, biz.businessId, { category: "Voidcheck" });
    const voided = await seedExpense(db, biz.businessId, {
      category: "Voidcheck", voidedAt: new Date("2020-02-02T00:00:00.000Z"),
    });

    const activeRes = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&voided=active")
      .set("Cookie", biz.cookie);
    expect(activeRes.status).toBe(200);
    const activeIds = exportLines(activeRes.text).slice(1).map((line) => line.split(",")[0]);
    expect(activeIds).toEqual([active.id]);

    const voidedRes = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&voided=voided")
      .set("Cookie", biz.cookie);
    expect(voidedRes.status).toBe(200);
    const voidedIds = exportLines(voidedRes.text).slice(1).map((line) => line.split(",")[0]);
    expect(voidedIds).toEqual([voided.id]);

    const allRes = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&voided=all")
      .set("Cookie", biz.cookie);
    expect(allRes.status).toBe(200);
    const allIds = exportLines(allRes.text).slice(1).map((line) => line.split(",")[0]).sort();
    expect(allIds).toEqual([active.id, voided.id].sort());

    // No voided parameter keeps the endpoint's stated behaviour: unfiltered
    // downloads include voided rows (the UI's bounds text says so).
    const defaultRes = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv")
      .set("Cookie", biz.cookie);
    expect(defaultRes.status).toBe(200);
    const defaultIds = exportLines(defaultRes.text).slice(1).map((line) => line.split(",")[0]).sort();
    expect(defaultIds).toEqual([active.id, voided.id].sort());
  });

  it("rejects an unparseable dateFrom with a 4xx VALIDATION error instead of an empty CSV", async () => {
    const biz = await registerBusiness("export-invalid-date@example.com", "Invalid Date Export Store");
    const res = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&dateFrom=not-a-date")
      .set("Cookie", biz.cookie);
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.code).toBe("VALIDATION");
  });

  it("rejects unknown enum values for method and voided with 4xx VALIDATION", async () => {
    const biz = await registerBusiness("export-invalid-enum@example.com", "Invalid Enum Export Store");
    const badMethod = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&method=bitcoin")
      .set("Cookie", biz.cookie);
    expect(badMethod.status).toBe(400);
    expect(badMethod.body.code).toBe("VALIDATION");

    const badVoided = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&voided=maybe")
      .set("Cookie", biz.cookie);
    expect(badVoided.status).toBe(400);
    expect(badVoided.body.code).toBe("VALIDATION");
  });

  it("states truncation when the filters still match more rows than the 1,000-row ceiling", async () => {
    const biz = await registerBusiness("export-over-ceiling@example.com", "Ceiling Export Store");
    const db = app.get("DbPort");
    const base = Date.UTC(2020, 0, 1);
    for (let i = 0; i < EXPORT_ROW_LIMIT + 5; i += 1) {
      await seedExpense(db, biz.businessId, {
        category: "Bulk", expenseDate: new Date(base + i * 1000),
      });
    }
    await seedExpense(db, biz.businessId, { category: "Rare" });

    const res = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&category=Bulk")
      .set("Cookie", biz.cookie);
    expect(res.status).toBe(200);
    const lines = exportLines(res.text);
    expect(lines[0]).toContain("id,category,amountMinor");
    // Header + exactly the ceiling + one stated truncation notice line.
    expect(lines.length).toBe(EXPORT_ROW_LIMIT + 2);
    expect(lines[EXPORT_ROW_LIMIT + 1]).toMatch(/^# Export truncated at 1,?000 rows\. .*export again\.$/);

    const narrow = await request(app.getHttpServer())
      .get("/api/v1/expenses/export?format=csv&category=Rare")
      .set("Cookie", biz.cookie);
    expect(narrow.status).toBe(200);
    const narrowLines = exportLines(narrow.text);
    expect(narrowLines.length).toBe(2);
    expect(narrowLines.some((line) => line.startsWith("#"))).toBe(false);
  });
});

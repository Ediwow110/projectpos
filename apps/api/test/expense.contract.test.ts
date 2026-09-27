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
  app = await createTestApp();
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
      .send({ category: "Tenant scoped", amountMinor: 700, method: "cash" });
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

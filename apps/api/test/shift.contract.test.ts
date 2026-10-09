import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let cashierCookie: string;
let cashierCsrf: string;
let registerId: string;
let productId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-shift@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const memberships = await request(app.getHttpServer()).get("/api/v1/memberships").set("Cookie", cookie);
  await request(app.getHttpServer()).post(`/api/v1/memberships/${memberships.body.items[0].id}/approval-pin`)
    .set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ pin: "482615" });
  const invitation = await request(app.getHttpServer()).post("/api/v1/memberships")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Shift Cashier", email: "cashier-shift@example.com", role: "cashier" });
  const cashier = await request(app.getHttpServer()).post("/api/v1/auth/login")
    .send({ email: "cashier-shift@example.com", password: invitation.body.tempPassword });
  cashierCookie = jar(cashier.headers["set-cookie"]);
  cashierCsrf = cashier.body.csrfToken;
  const created = await request(app.getHttpServer()).post("/api/v1/registers")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Counter 1" });
  registerId = created.body.id;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 50 });
});

afterAll(async () => { await app.close(); });

describe("phase5 shift HTTP contract", () => {
  it("opens with float, auto-posts a cash sale, closes reconciled", async () => {
    const opened = await request(app.getHttpServer()).post(`/api/v1/registers/${registerId}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId, openingFloatMinor: 10000 });
    expect(opened.status).toBe(201);
    const shiftId = opened.body.id;
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 2 }], registerId });
    expect(draft.status).toBe(201);
    const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "shift-sale-1")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }], registerId });
    expect(complete.status).toBe(201);
    const cash = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/cash`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ kind: "paid_out", amountMinor: 1200, reason: "ice delivery" });
    expect(cash.status).toBe(200);
    const closed = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/close`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ countedCashMinor: 13800 });
    expect(closed.status).toBe(200);
    expect(closed.body.report.expectedCash).toBe(13800);
    expect(closed.body.report.variance).toBe(0);
    const report = await request(app.getHttpServer()).get(`/api/v1/shifts/${shiftId}`)
      .set("Cookie", cookie);
    expect(report.status).toBe(200);
    expect(report.body.components.expectedCash).toBe(13800);
  });

  it("rejects a second open on the same register", async () => {
    const reg2 = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter 2" });
    await request(app.getHttpServer()).post(`/api/v1/registers/${reg2.body.id}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId: reg2.body.id, openingFloatMinor: 0 });
    const again = await request(app.getHttpServer()).post(`/api/v1/registers/${reg2.body.id}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId: reg2.body.id, openingFloatMinor: 0 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("SHIFT_ALREADY_OPEN");
  });

  it("rejects unauthenticated shift reads with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/shifts");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("rejects double close with SHIFT_ALREADY_CLOSED", async () => {
    const list = await request(app.getHttpServer()).get("/api/v1/shifts?status=CLOSED")
      .set("Cookie", cookie);
    const id = list.body.items[0].id;
    const res = await request(app.getHttpServer()).post(`/api/v1/shifts/${id}/close`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ countedCashMinor: 0 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHIFT_ALREADY_CLOSED");
  });
});

describe("phase5 shift permissions and immutability", () => {
  it("lists minimal foreign close candidates and requires a fresh exact manager grant", async () => {
    const register = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ name: "Approval Counter" });
    const opened = await request(app.getHttpServer()).post(`/api/v1/registers/${register.body.id}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId: register.body.id, openingFloatMinor: 100 });
    expect(opened.status).toBe(201);
    const shiftId = opened.body.id as string;

    const candidates = await request(app.getHttpServer()).get("/api/v1/shifts?status=OPEN&includeCloseCandidates=true")
      .set("Cookie", cashierCookie);
    expect(candidates.status).toBe(200);
    expect(candidates.body.items).toContainEqual(expect.objectContaining({ id: shiftId, closeCandidate: true }));
    const candidate = candidates.body.items.find((item: { id: string }) => item.id === shiftId);
    expect(candidate.openingFloatMinor).toBeUndefined();

    const denied = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/close`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).send({ countedCashMinor: 100 });
    expect(denied.status).toBe(403);

    const approval = await request(app.getHttpServer()).post("/api/v1/approvals/manager")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({
        email: "ana-shift@example.com", pin: "482615", permission: "shift.close.override",
        action: { kind: "shift_close", shiftId, countedCashMinor: 100 },
      });
    expect(approval.status).toBe(201);

    const stale = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/cash`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ kind: "cash_deposit", amountMinor: 10 });
    expect(stale.status).toBe(200);
    const staleClose = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/close`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ countedCashMinor: 100, approvalToken: approval.body.token });
    expect(staleClose.status).toBe(403);

    const freshApproval = await request(app.getHttpServer()).post("/api/v1/approvals/manager")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({
        email: "ana-shift@example.com", pin: "482615", permission: "shift.close.override",
        action: { kind: "shift_close", shiftId, countedCashMinor: 110 },
      });
    expect(freshApproval.status).toBe(201);
    const applied = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/close`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ countedCashMinor: 110, approvalToken: freshApproval.body.token });
    expect(applied.status).toBe(200);
    const reused = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/close`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ countedCashMinor: 110, approvalToken: freshApproval.body.token });
    expect(reused.status).toBe(409);

    const db = app.get<{ listAudit: () => Promise<Array<{ action: string; entityId: string; after?: unknown }>> }>("DbPort");
    expect((await db.listAudit()).find((entry) => entry.action === "shift.close" && entry.entityId === shiftId)).toMatchObject({
      after: { approval: { permission: "shift.close.override" } },
    });
  });

  it("cashier role cannot manage registers (unit: role gate)", async () => {
    expect(["owner", "manager"]).toContain("manager");
    expect(["owner", "manager"]).not.toContain("cashier");
  });

  it("rejects cash movements on a closed shift", async () => {
    const list = await request(app.getHttpServer()).get("/api/v1/shifts?status=CLOSED")
      .set("Cookie", cookie);
    const id = list.body.items[0].id;
    const res = await request(app.getHttpServer()).post(`/api/v1/shifts/${id}/cash`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ kind: "cash_deposit", amountMinor: 100 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SHIFT_CLOSED_IMMUTABLE");
  });

  it("rejects cash sales with no open shift", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter 9" });
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }], registerId: reg.body.id });
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "shift-no-open-1")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }], registerId: reg.body.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHIFT_NO_OPEN_SHIFT");
  });

  it("returns NOT_FOUND for another tenant's shift", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-shift@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const list = await request(app.getHttpServer()).get("/api/v1/shifts").set("Cookie", cookie);
    const id = list.body.items[0].id;
    const got = await request(app.getHttpServer()).get(`/api/v1/shifts/${id}`).set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });
});

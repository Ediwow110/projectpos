import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

const oldKey = process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
const ownerEmail = "first-value-owner@example.com";
const ownerPassword = "correct-horse-12";

function cookies(headers: unknown): string {
  const values = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return values.map((value) => String(value).split(";")[0]).join("; ");
}

describe("first-time manager-approved customer value HTTP contract", () => {
  let app: INestApplication;
  let db: DbPort;
  let businessId: string;
  let customerId: string;
  let ownerCookie: string;
  let ownerCsrf: string;
  let cashierCookie: string;
  let cashierCsrf: string;

  beforeAll(async () => {
    process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = "d9".repeat(32);
    app = await createTestApp({ completedOnboardingFixture: true });
    db = app.get<DbPort>("DbPort");
    const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Value owner", email: ownerEmail, password: ownerPassword,
      businessName: "First value store",
    });
    expect(owner.status).toBe(201);
    businessId = owner.body.business.id as string;
    ownerCookie = cookies(owner.headers["set-cookie"]);
    ownerCsrf = owner.body.csrfToken as string;
    const invited = await request(app.getHttpServer()).post("/api/v1/memberships")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ name: "Value cashier", email: "first-value-cashier@example.com", role: "cashier" });
    const cashier = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ email: "first-value-cashier@example.com", password: invited.body.tempPassword });
    cashierCookie = cookies(cashier.headers["set-cookie"]);
    cashierCsrf = cashier.body.csrfToken as string;
    customerId = (await db.createCustomer({ businessId, name: "First value customer", phone: null,
      email: null, address: null, notes: null, isActive: true })).id;
  });

  afterAll(async () => {
    await app?.close();
    if (oldKey === undefined) delete process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
    else process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = oldKey;
  });

  async function approval(valueType: "store_credit" | "loyalty", amountDelta: number, key: string) {
    const action = { kind: "value_adjustment", valueType, targetId: customerId,
      amountDelta, reason: "Manager authorized correction" };
    const created = await request(app.getHttpServer()).post("/api/v1/approvals/requests")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ action, idempotencyKey: key });
    expect(created.status).toBe(201);
    const id = created.body.request.id as string;
    const decided = await request(app.getHttpServer()).post(`/api/v1/approvals/requests/${id}/decision`)
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ decision: "APPROVED", email: ownerEmail, password: ownerPassword });
    expect(decided.status).toBe(201);
    const claimed = await request(app.getHttpServer()).post(`/api/v1/approvals/requests/${id}/claim`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).send({});
    expect(claimed.status).toBe(201);
    return claimed.body.token as string;
  }

  it("creates no account on denial, then applies one store-credit correction", async () => {
    expect(await db.findStoreCreditAccount(customerId, businessId)).toBeNull();
    const denied = await request(app.getHttpServer()).post(`/api/v1/customers/${customerId}/store-credit/adjust`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .set("Idempotency-Key", "first-value-denied")
      .send({ amountMinor: 500, reason: "Manager authorized correction" });
    expect(denied.status).toBe(403);
    expect(await db.findStoreCreditAccount(customerId, businessId)).toBeNull();

    const token = await approval("store_credit", 500, "first-credit-approval");
    expect(await db.findStoreCreditAccount(customerId, businessId)).toBeNull();
    const applied = await request(app.getHttpServer()).post(`/api/v1/customers/${customerId}/store-credit/adjust`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .set("Idempotency-Key", "first-credit-adjust")
      .send({ amountMinor: 500, reason: "Manager authorized correction", approvalToken: token });
    expect(applied.status).toBe(201);
    expect(applied.body.balanceMinor).toBe(500);
    const account = await db.findStoreCreditAccount(customerId, businessId);
    expect(account).not.toBeNull();
    expect(await db.listStoreCreditTransactions(account!.id, businessId)).toHaveLength(1);
    const reused = await request(app.getHttpServer()).post(`/api/v1/customers/${customerId}/store-credit/adjust`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .set("Idempotency-Key", "first-credit-adjust")
      .send({ amountMinor: 500, reason: "Manager authorized correction", approvalToken: token });
    expect(reused.status).toBe(403);
    expect(await db.listStoreCreditTransactions(account!.id, businessId)).toHaveLength(1);
  });

  it("creates one loyalty account only when the approved correction is applied", async () => {
    expect(await db.findLoyaltyAccount(customerId, businessId)).toBeNull();
    const token = await approval("loyalty", 25, "first-loyalty-approval");
    expect(await db.findLoyaltyAccount(customerId, businessId)).toBeNull();
    const applied = await request(app.getHttpServer()).post(`/api/v1/customers/${customerId}/loyalty/adjust`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .set("Idempotency-Key", "first-loyalty-adjust")
      .send({ amountMinor: 25, reason: "Manager authorized correction", approvalToken: token });
    expect(applied.status).toBe(201);
    expect(applied.body.points).toBe(25);
    const account = await db.findLoyaltyAccount(customerId, businessId);
    expect(account).not.toBeNull();
    expect(await db.listLoyaltyTransactions(account!.id, businessId)).toHaveLength(1);
  });
});

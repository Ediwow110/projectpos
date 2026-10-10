import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

let app: INestApplication;
let ownerCookie: string;
let ownerCsrf: string;
let cashierCookie: string;
let cashierCsrf: string;
let productId: string;
let customerId: string;
let businessId: string;
let storeCreditAccountId: string;

function jar(headers: unknown): string {
  const values = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return values.map((header) => String(header).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Approval Owner", email: "approval-owner-contract@example.com", password: "correct-horse-12", businessName: "Approval Store",
  });
  ownerCookie = jar(owner.headers["set-cookie"]);
  ownerCsrf = owner.body.csrfToken as string;
  const memberships = await request(app.getHttpServer()).get("/api/v1/memberships").set("Cookie", ownerCookie);
  const ownerMembership = memberships.body.items[0] as { id: string };
  await request(app.getHttpServer()).post(`/api/v1/memberships/${ownerMembership.id}/approval-pin`)
    .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf).send({ pin: "482615" });
  const invitation = await request(app.getHttpServer()).post("/api/v1/memberships")
    .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
    .send({ name: "Approval Cashier", email: "approval-cashier-contract@example.com", role: "cashier" });
  const cashier = await request(app.getHttpServer()).post("/api/v1/auth/login")
    .send({ email: "approval-cashier-contract@example.com", password: invitation.body.tempPassword });
  cashierCookie = jar(cashier.headers["set-cookie"]);
  cashierCsrf = cashier.body.csrfToken as string;
  const product = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
    .send({ name: "Approval Coffee", priceMinor: 2500, costMinor: 500 });
  productId = product.body.id as string;
  const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", ownerCookie);
  businessId = me.body.businessId as string;
  const db = app.get<DbPort>("DbPort");
  customerId = (await db.createCustomer({ businessId, name: "Approval Customer", phone: null, email: null, address: null, notes: null, isActive: true })).id;
  storeCreditAccountId = (await db.createStoreCreditAccount({ businessId, customerId })).id;
});

afterAll(async () => { await app.close(); });

describe("generic manager approval contract", () => {
  async function draftId(): Promise<string> {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ lines: [{ productId, qty: 1 }] });
    expect(draft.status).toBe(201);
    return draft.body.id as string;
  }

  it("mints an exact void grant without returning credential material", async () => {
    const saleId = await draftId();
    const denied = await request(app.getHttpServer()).post("/api/v1/approvals/manager")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({
        email: "approval-owner-contract@example.com", pin: "111111", permission: "sale.void",
        action: { kind: "sale_void", saleId, reason: "Duplicate order" },
      });
    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe("AUTH_INVALID_CREDENTIALS");

    const approved = await request(app.getHttpServer()).post("/api/v1/approvals/manager")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({
        email: "approval-owner-contract@example.com", pin: "482615", permission: "sale.void",
        action: { kind: "sale_void", saleId, reason: "Duplicate order" },
      });
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ token: expect.stringMatching(/^mgr_/), approver: { role: "owner" } });
    expect(JSON.stringify(approved.body)).not.toMatch(/password|pin|hash/i);
  });

  it("rejects action and permission pairs outside the public contract", async () => {
    const saleId = await draftId();
    const response = await request(app.getHttpServer()).post("/api/v1/approvals/manager")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({
        email: "approval-owner-contract@example.com", pin: "482615", permission: "inventory.adjust",
        action: { kind: "sale_void", saleId, reason: "Duplicate order" },
      });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION");
  });

  it("consumes an exact void grant once and preserves the operational actor in its audit", async () => {
    const saleId = await draftId();
    const otherSaleId = await draftId();
    const denied = await request(app.getHttpServer()).post(`/api/v1/sales/${saleId}/void`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ reason: "Duplicate order" });
    expect(denied.status).toBe(403);

    const approval = await request(app.getHttpServer()).post("/api/v1/approvals/manager")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({
        email: "approval-owner-contract@example.com", pin: "482615", permission: "sale.void",
        action: { kind: "sale_void", saleId, reason: "Duplicate order" },
      });
    const wrongSale = await request(app.getHttpServer()).post(`/api/v1/sales/${otherSaleId}/void`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ reason: "Duplicate order", approvalToken: approval.body.token });
    expect(wrongSale.status).toBe(403);

    const applied = await request(app.getHttpServer()).post(`/api/v1/sales/${saleId}/void`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ reason: "Duplicate order", approvalToken: approval.body.token });
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe("VOIDED");

    const cashier = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cashierCookie);
    const db = app.get<{ listAudit: () => Promise<Array<{ action: string; actorId: string; entityId: string; after?: unknown }>> }>("DbPort");
    expect((await db.listAudit()).find((entry) => entry.action === "sale.void" && entry.entityId === saleId)).toMatchObject({
      actorId: cashier.body.userId,
      after: { approval: { permission: "sale.void" } },
    });
  });

  it("allows an exact manager-approved inventory movement once and records its approval", async () => {
    const movement = { productId, type: "receive", qtyDelta: 5, reason: "Vendor delivery" };
    const denied = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).send(movement);
    expect(denied.status).toBe(403);

    const approval = await request(app.getHttpServer()).post("/api/v1/approvals/manager")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({
        email: "approval-owner-contract@example.com", pin: "482615", permission: "inventory.adjust",
        action: {
          kind: "inventory_movement",
          productId: movement.productId,
          movementType: movement.type,
          qtyDelta: movement.qtyDelta,
          reason: movement.reason,
        },
      });
    expect(approval.status).toBe(201);

    const mismatch = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ ...movement, qtyDelta: 6, approvalToken: approval.body.token });
    expect(mismatch.status).toBe(403);

    const applied = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ ...movement, approvalToken: approval.body.token });
    expect(applied.status).toBe(201);

    const reused = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ ...movement, approvalToken: approval.body.token });
    expect(reused.status).toBe(403);

    const cashier = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cashierCookie);
    const db = app.get<{ listAudit: () => Promise<Array<{ action: string; actorId: string; entityId: string; after?: unknown }>> }>("DbPort");
    expect((await db.listAudit()).find((entry) => entry.action === "inventory.adjust" && entry.entityId === applied.body.id)).toMatchObject({
      actorId: cashier.body.userId,
      after: { approval: { permission: "inventory.adjust" } },
    });
  });

  it("records separate value-adjustment and manager-approval audits for a manager-approved adjustment", async () => {
    const amountMinor = 1000;
    const reason = "Manager value correction";
    const denied = await request(app.getHttpServer()).post(`/api/v1/customers/${customerId}/store-credit/adjust`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).set("Idempotency-Key", "value-adjust-denied")
      .send({ amountMinor, reason, counterAccountCode: "6000" });
    expect(denied.status).toBe(403);

    const approval = await request(app.getHttpServer()).post("/api/v1/approvals/manager")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({
        email: "approval-owner-contract@example.com", pin: "482615", permission: "stored_value.adjust",
        action: { kind: "value_adjustment", valueType: "store_credit", targetId: customerId, amountDelta: amountMinor, counterAccountCode: "6000", reason },
      });
    expect(approval.status).toBe(201);

    const applied = await request(app.getHttpServer()).post(`/api/v1/customers/${customerId}/store-credit/adjust`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).set("Idempotency-Key", "value-adjust-1")
      .send({ amountMinor, reason, counterAccountCode: "6000", approvalToken: approval.body.token });
    expect([200, 201]).toContain(applied.status);

    const db = app.get<DbPort>("DbPort");
    const audits = (await db.listAudit()).filter((entry) => entry.entityId === storeCreditAccountId);
    expect(audits.filter((entry) => entry.action === "store-credit.adjust")).toHaveLength(1);
    expect(audits.filter((entry) => entry.action === "manager.approval.applied")).toHaveLength(1);
    expect(audits.find((entry) => entry.action === "store-credit.adjust")).toMatchObject({
      actorId: expect.any(String),
      before: { balanceMinor: 0 },
      after: { amountDeltaMinor: amountMinor, balanceMinor: amountMinor },
    });
  });
});

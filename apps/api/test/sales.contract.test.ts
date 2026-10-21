import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let productId: string;
let businessId: string;
let ownerUserId: string;

const OWNER_EMAIL = "ana-sale@example.com";
const OWNER_PASSWORD = "correct-horse-12";

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: OWNER_EMAIL,
    password: OWNER_PASSWORD, businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie);
  businessId = me.body.businessId as string;
  ownerUserId = me.body.userId as string;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 50 });
});

afterAll(async () => { await app.close(); });

describe("phase4 sales HTTP contract", () => {
  it("preserves the cashier's add-to-cart order through draft and receipt retrieval", async () => {
    const created: Array<{ id: string; name: string }> = [];
    for (const name of ["Zebra Water", "Apple Juice", "Mango Soda"]) {
      const product = await request(app.getHttpServer()).post("/api/v1/products")
        .set("Cookie", cookie).set("X-CSRF-Token", csrf)
        .send({ name, priceMinor: 1000, costMinor: 400 });
      expect(product.status).toBe(201);
      created.push({ id: product.body.id as string, name });
      const stock = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
        .set("Cookie", cookie).set("X-CSRF-Token", csrf)
        .send({ productId: product.body.id, type: "opening_stock", qtyDelta: 10 });
      expect(stock.status).toBe(201);
    }

    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: created.map((product) => ({ productId: product.id, qty: 1 })) });
    expect(draft.status).toBe(201);

    const receipt = await request(app.getHttpServer()).get(`/api/v1/receipts/${draft.body.id}`)
      .set("Cookie", cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.items.map((item: { name: string }) => item.name)).toEqual(
      created.map((product) => product.name),
    );
    expect(receipt.body.items.map((item: { position: number }) => item.position)).toEqual([0, 1, 2]);
  });

  it("drafts and completes a cash sale end-to-end with receipt", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 2 }] });
    expect(draft.status).toBe(201);
    const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-0001")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(complete.status).toBe(201);
    expect(complete.body.status).toBe("COMPLETED");
    const receipt = await request(app.getHttpServer()).get(`/api/v1/receipts/${draft.body.id}`)
      .set("Cookie", cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.receiptNo).toBeTruthy();
  });

  it("replays the same idempotency key without a duplicate", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const first = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-replay")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-replay")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.id).toBe(first.body.id);
  });

  it("rejects split-total mismatch with PAYMENT_TOTAL_MISMATCH", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-mismatch")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PAYMENT_TOTAL_MISMATCH");
  });

  it("rejects unauthenticated sales read with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/sales");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});

describe("phase4 sales permissions, unknown, and cross-tenant", () => {
  it("lets a cashier use one exact owner-approved over-threshold discount", async () => {
    const ownerMemberships = await request(app.getHttpServer()).get("/api/v1/memberships").set("Cookie", cookie);
    const ownerMembership = ownerMemberships.body.items.find((item: { userId: string }) => item.userId === ownerUserId);
    expect(ownerMembership).toBeTruthy();
    const pinSet = await request(app.getHttpServer()).post(`/api/v1/memberships/${ownerMembership.id}/approval-pin`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ pin: "482615" });
    expect(pinSet.status).toBe(200);
    const ownerMembershipsAfter = await request(app.getHttpServer()).get("/api/v1/memberships").set("Cookie", cookie);
    expect(ownerMembershipsAfter.body.items.find((item: { id: string }) => item.id === ownerMembership.id)).toMatchObject({
      approvalPinSet: true,
    });
    expect(JSON.stringify(ownerMembershipsAfter.body)).not.toContain("approvalPinHash");

    const inviteEmail = `approval-cashier-${Date.now()}@example.com`;
    const invited = await request(app.getHttpServer()).post("/api/v1/memberships")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Approval Cashier", email: inviteEmail, role: "cashier" });
    expect(invited.status).toBe(201);

    const cashierLogin = await request(app.getHttpServer()).post("/api/v1/auth/login").send({
      email: inviteEmail,
      password: invited.body.tempPassword,
    });
    expect(cashierLogin.status).toBe(201);
    const cashierCookie = jar(cashierLogin.headers["set-cookie"]);
    const cashierCsrf = cashierLogin.body.csrfToken as string;
    const cashierMe = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cashierCookie);
    const cashierUserId = cashierMe.body.userId as string;
    const discounted = { lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 1000 };

    const denied = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).send(discounted);
    expect(denied.status).toBe(403);

    const badApproval = await request(app.getHttpServer()).post("/api/v1/sales/discount-approval")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ ...discounted, email: OWNER_EMAIL, pin: "111111" });
    expect(badApproval.status).toBe(401);

    const approval = await request(app.getHttpServer()).post("/api/v1/sales/discount-approval")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ ...discounted, email: OWNER_EMAIL, pin: "482615" });
    expect(approval.status).toBe(201);
    expect(approval.body.token).toMatch(/^mgr_/);
    expect(approval.body.approver).toMatchObject({ name: "Ana", role: "owner" });

    const approved = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ ...discounted, approvalToken: approval.body.token });
    expect(approved.status).toBe(201);
    expect(approved.body.discountMinor).toBe(1000);

    const replay = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf)
      .send({ ...discounted, approvalToken: approval.body.token });
    expect(replay.status).toBe(403);

    const db = app.get<{ listAudit: () => Promise<Array<{ actorId: string; action: string; entityId: string; after?: unknown }>> }>("DbPort");
    const applied = (await db.listAudit()).find((entry) =>
      entry.action === "manager.approval.applied" && entry.entityId === approved.body.id,
    );
    expect(applied).toMatchObject({
      actorId: ownerUserId,
      after: {
        requesterId: cashierUserId,
        permission: "discount.override",
        orderDiscountMinor: 1000,
        lineDiscountMinor: 0,
      },
    });
  });

  it("cashier role lacks sale.void and sale.refund", async () => {
    const { AuthService } = await import("../src/auth/nest/auth.service");
    const svc = new AuthService({} as never);
    expect(svc.rolePermissions("cashier")).not.toContain("sale.void");
    expect(svc.rolePermissions("cashier")).not.toContain("sale.refund");
    expect(svc.rolePermissions("manager")).toContain("sale.refund");
  });

  it("unknown provider outcome returns 202 and a bare claim cannot reconcile it", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-unknown")
      .send({
        saleId: draft.body.id,
        payments: [{ method: "gcash", amountMinor: draft.body.totalMinor, providerRef: "unknown-1" }],
      });
    expect(res.status).toBe(202);
    expect(res.body.code).toBe("PAYMENT_UNKNOWN");
    const paymentId = res.body.sale.payments[0].id;

    // This assertion used to require 200 + COMPLETED here, which is the
    // vulnerability: a caller could finish a hosted sale the provider had
    // never confirmed. Reconcile now answers 202 and leaves the leg UNKNOWN;
    // the next test covers the path where the provider does confirm it.
    const rec = await request(app.getHttpServer()).post(`/api/v1/payments/${paymentId}/reconcile`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "rec-key-1")
      .send({ outcome: "SUCCEEDED" });
    expect(rec.status).toBe(202);
    expect(rec.body.code).toBe("PAYMENT_UNKNOWN");
    const after = await request(app.getHttpServer()).get(`/api/v1/sales/${draft.body.id}`)
      .set("Cookie", cookie);
    expect(after.body.status).toBe("PAYMENT_UNKNOWN");
  });

  it("queries the test-double provider then reconciles to completed", async () => {
    const { setTestDoubleOutcome, clearTestDoubleOutcomes } = await import("../src/payments/provider");
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "sale-key-provider")
      .send({
        saleId: draft.body.id,
        payments: [{ method: "gcash", amountMinor: draft.body.totalMinor, providerRef: "unknown-td-1" }],
      });
    expect(res.status).toBe(202);
    const paymentId = res.body.sale.payments[0].id;
    const before = await request(app.getHttpServer())
      .get(`/api/v1/payments/${paymentId}/provider-status?provider=test-double`)
      .set("Cookie", cookie);
    expect(before.status).toBe(200);
    expect(before.body.status).toBe("UNKNOWN");
    setTestDoubleOutcome("unknown-td-1", "SUCCEEDED", businessId);
    try {
      const after = await request(app.getHttpServer())
        .get(`/api/v1/payments/${paymentId}/provider-status?provider=test-double`)
        .set("Cookie", cookie);
      expect(after.body.status).toBe("SUCCEEDED");
      const rec = await request(app.getHttpServer()).post(`/api/v1/payments/${paymentId}/reconcile`)
        .set("Cookie", cookie).set("X-CSRF-Token", csrf)
        .set("Idempotency-Key", "rec-key-provider")
        .send({ outcome: "SUCCEEDED" });
      expect(rec.status).toBe(200);
      expect(rec.body.sale.status).toBe("COMPLETED");
    } finally {
      clearTestDoubleOutcomes();
    }
  });

  it("returns NOT_FOUND for another tenant's sale", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-sale@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const list = await request(app.getHttpServer()).get("/api/v1/sales").set("Cookie", cookie);
    const id = list.body.items[0].id;
    const got = await request(app.getHttpServer()).get(`/api/v1/sales/${id}`).set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });

  it("holds and resumes a draft", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1, lineDiscountMinor: 500 }], orderDiscountMinor: 200 });
    const held = await request(app.getHttpServer()).post(`/api/v1/sales/${draft.body.id}/hold`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(held.status).toBe(200);
    const heldList = await request(app.getHttpServer()).get("/api/v1/sales/held")
      .set("Cookie", cookie);
    expect(heldList.status).toBe(200);
    expect(heldList.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        heldId: held.body.id,
        sale: expect.objectContaining({
          id: draft.body.id,
          status: "DRAFT",
          discountMinor: 200,
          items: [expect.objectContaining({ productId, qty: 1, name: "Coke", lineDiscountMinor: 500 })],
        }),
      }),
    ]));
    const resumed = await request(app.getHttpServer()).post(`/api/v1/sales/${draft.body.id}/resume`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe("DRAFT");
    const afterResume = await request(app.getHttpServer()).get("/api/v1/sales/held")
      .set("Cookie", cookie);
    expect(afterResume.status).toBe(200);
    expect(afterResume.body.items.some((item: { sale: { id: string } }) => item.sale.id === draft.body.id)).toBe(false);
  });

  it("returns discounted receipt totals from the authoritative draft", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({
        lines: [{ productId, qty: 2, lineDiscountMinor: 500 }],
        orderDiscountMinor: 400,
      });
    expect(draft.status).toBe(201);
    expect(draft.body.subtotalMinor).toBe(4500);
    expect(draft.body.discountMinor).toBe(400);
    expect(draft.body.totalMinor).toBe(4100);

    const receipt = await request(app.getHttpServer()).get(`/api/v1/receipts/${draft.body.id}`)
      .set("Cookie", cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.discountMinor).toBe(400);
    expect(receipt.body.totalMinor).toBe(4100);
    expect(receipt.body.items[0]).toMatchObject({ lineDiscountMinor: 500, lineTotalMinor: 4500 });
  });
});

describe("phase11 configured payment methods", () => {
  it("exposes the configured method list and rejects an unconfigured tender", async () => {
    const db = app.get<{ saveSettings: (b: string, s: Record<string, unknown>) => Promise<void>; getSettings: (b: string) => Promise<Record<string, unknown>> }>("DbPort");
    await db.saveSettings(businessId, {
      ...(await db.getSettings(businessId)),
      paymentMethods: [{ key: "cash", label: "Cash" }],
    });

    const methods = await request(app.getHttpServer()).get("/api/v1/payments/methods").set("Cookie", cookie);
    expect(methods.status).toBe(200);
    expect(methods.body.methods.map((m: { key: string }) => m.key)).toEqual(["cash"]);

    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    expect(draft.status).toBe(201);
    const rejected = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", `pm-config-${Date.now()}`)
      .send({ saleId: draft.body.id, payments: [{ method: "gcash", amountMinor: draft.body.totalMinor }] });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("VALIDATION");

    const accepted = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", `pm-config-ok-${Date.now()}`)
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(accepted.status).toBe(201);
  });
});

describe("phase11 receipt download and share", () => {
  it("downloads a receipt as text and shares it without a session", async () => {
    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }] });
    const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", `share-${Date.now()}`)
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    const saleId = complete.body.id as string;

    const download = await request(app.getHttpServer())
      .get(`/api/v1/receipts/${saleId}/download`).set("Cookie", cookie);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("text/plain");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.text).toContain(`Receipt ${complete.body.receiptNo}`);

    const share = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${saleId}/share`).set("Cookie", cookie).set("X-CSRF-Token", csrf);
    expect(share.status).toBe(201);
    const shared = await request(app.getHttpServer())
      .get(`/api/v1/receipts/shared/${share.body.token}`);
    expect(shared.status).toBe(200);
    expect(shared.body.receiptNo).toBe(complete.body.receiptNo);
    expect(shared.body.tenders).toHaveLength(1);

    const bad = await request(app.getHttpServer()).get("/api/v1/receipts/shared/ffffffffffffffffffffffffffffffff");
    expect(bad.status).toBe(404);
  });
});

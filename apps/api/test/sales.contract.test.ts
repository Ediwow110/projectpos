import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let productId: string;
let businessId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-sale@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie);
  businessId = me.body.businessId as string;
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
      .send({ saleId: draft.body.id, payments: [{ method: "card", amountMinor: 1 }] });
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
  it("cashier role lacks sale.void and sale.refund", async () => {
    const { AuthService } = await import("../src/auth/nest/auth.service");
    const svc = new AuthService({} as never);
    expect(svc.rolePermissions("cashier")).not.toContain("sale.void");
    expect(svc.rolePermissions("cashier")).not.toContain("sale.refund");
    expect(svc.rolePermissions("manager")).toContain("sale.refund");
  });

  it("unknown provider outcome returns 202 with reconcile path", async () => {
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
    const rec = await request(app.getHttpServer()).post(`/api/v1/payments/${paymentId}/reconcile`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "rec-key-1")
      .send({ outcome: "SUCCEEDED" });
    expect(rec.status).toBe(200);
    expect(rec.body.sale.status).toBe("COMPLETED");
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
      .send({ lines: [{ productId, qty: 1 }] });
    const held = await request(app.getHttpServer()).post(`/api/v1/sales/${draft.body.id}/hold`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(held.status).toBe(200);
    const resumed = await request(app.getHttpServer()).post(`/api/v1/sales/${draft.body.id}/resume`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe("DRAFT");
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

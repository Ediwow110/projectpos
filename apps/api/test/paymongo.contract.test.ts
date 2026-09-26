import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";
import type {
  PayMongoCheckoutInput,
  PayMongoCheckoutResult,
  PayMongoCheckoutSnapshot,
  PayMongoPort,
} from "../src/payments/paymongo";

class FakePayMongo implements PayMongoPort {
  createCount = 0;
  private readonly sessions = new Map<string, { url: string; input: PayMongoCheckoutInput }>();

  configured(): boolean { return true; }

  async createCheckout(input: PayMongoCheckoutInput): Promise<PayMongoCheckoutResult> {
    this.createCount += 1;
    const sessionId = `cs_${input.saleId}`;
    const checkoutUrl = `https://checkout.paymongo.test/${sessionId}`;
    this.sessions.set(sessionId, { url: checkoutUrl, input });
    return { sessionId, checkoutUrl };
  }

  async retrieveCheckout(sessionId: string): Promise<PayMongoCheckoutSnapshot> {
    const found = this.sessions.get(sessionId);
    return found
      ? { sessionId, checkoutUrl: found.url, status: "active", paid: false }
      : { sessionId, checkoutUrl: null, status: "unknown", paid: false };
  }

  verifyWebhook(_rawBody: string, signatureHeader: string | undefined): boolean {
    return signatureHeader === "valid";
  }
}

let app: INestApplication;
let cookie: string;
let csrf: string;
let businessId: string;
let productId: string;
let db: DbPort;
const paymongo = new FakePayMongo();

function jar(header: unknown): string {
  const values = Array.isArray(header) ? header : [String(header ?? "")];
  return values.map((value) => String(value).split(";")[0]).join("; ");
}

async function draftSale(qty = 1): Promise<{ id: string; receiptNo: string; totalMinor: number }> {
  const response = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ lines: [{ productId, qty }] });
  expect(response.status).toBe(201);
  return response.body as { id: string; receiptNo: string; totalMinor: number };
}

beforeAll(async () => {
  process.env["WEB_URL"] = "https://pos.example.com";
  app = await createTestApp({ paymongo });
  db = app.get<DbPort>("DbPort");
  const registration = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "PayMongo Owner",
    email: "paymongo-owner@example.com",
    password: "correct-horse-12",
    businessName: "PayMongo Store",
  });
  cookie = jar(registration.headers["set-cookie"]);
  csrf = registration.body.csrfToken as string;
  const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie);
  businessId = me.body.businessId as string;
  const product = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "PayMongo Coffee", priceMinor: 2500, costMinor: 1000 });
  productId = product.body.id as string;
  const stock = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 10 });
  expect(stock.status).toBe(201);
});

afterAll(async () => {
  await app.close();
  delete process.env["WEB_URL"];
});

describe("PayMongo hosted checkout contract", () => {
  it("advertises PayMongo-backed electronic methods", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/payments/methods").set("Cookie", cookie);
    expect(response.status).toBe(200);
    for (const key of ["card", "gcash", "maya"]) {
      expect(response.body.methods).toContainEqual(expect.objectContaining({ key, available: true, provider: "paymongo" }));
    }
  });

  it("blocks direct successful electronic completion outside the provider flow", async () => {
    const sale = await draftSale();
    const response = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "paymongo-direct-block")
      .send({ saleId: sale.id, payments: [{ method: "gcash", amountMinor: sale.totalMinor }] });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PAYMENT_PROVIDER_REQUIRED");
  });

  it("creates one hosted checkout, resumes it, and settles exactly once from a signed webhook", async () => {
    const sale = await draftSale();
    const first = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/paymongo/checkout`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "paymongo-checkout-1")
      .send({ method: "gcash" });
    expect(first.status).toBe(201);
    expect(first.body.sale.status).toBe("PENDING_PAYMENT");
    expect(first.body.payment).toMatchObject({ method: "gcash", status: "PENDING", amountMinor: sale.totalMinor });
    expect(first.body.checkoutUrl).toBe(`https://checkout.paymongo.test/cs_${sale.id}`);
    expect(paymongo.createCount).toBe(1);

    const resumed = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/paymongo/checkout`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "paymongo-checkout-2")
      .send({ method: "gcash" });
    expect(resumed.status).toBe(200);
    expect(resumed.body.replayed).toBe(true);
    expect(paymongo.createCount).toBe(1);

    const raw = JSON.stringify({
      data: {
        id: "evt_checkout_paid_1",
        type: "checkout_session.payment.paid",
        data: {
          id: first.body.checkoutSessionId,
          type: "checkout_session",
          attributes: {
            reference_number: sale.id,
            metadata: { businessId, saleId: sale.id, receiptNo: sale.receiptNo, method: "gcash" },
            payments: [{
              id: "pay_paymongo_1",
              attributes: { status: "paid", amount: sale.totalMinor, currency: "PHP", source: { type: "gcash" } },
            }],
          },
        },
      },
    });
    const webhook = await request(app.getHttpServer()).post("/api/v1/payments/paymongo/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", "valid")
      .send(raw);
    expect(webhook.status).toBe(200);
    expect(webhook.body).toEqual({ handled: true });

    const completed = await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie);
    expect(completed.body.status).toBe("COMPLETED");
    expect(completed.body.paidMinor).toBe(sale.totalMinor);
    expect(completed.body.payments[0]).toMatchObject({ status: "SUCCEEDED", providerRef: first.body.checkoutSessionId });
    expect((await db.findBalance(productId, businessId, null))?.qtyOnHand).toBe(9);

    const duplicate = await request(app.getHttpServer()).post("/api/v1/payments/paymongo/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", "valid")
      .send(raw);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ handled: true, deduplicated: true });
    expect((await db.findBalance(productId, businessId, null))?.qtyOnHand).toBe(9);
  });

  it("rejects bad signatures before touching payment state", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/payments/paymongo/webhook")
      .set("Paymongo-Signature", "invalid")
      .send({ data: { id: "evt_bad", type: "checkout_session.payment.paid" } });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
  });

  it("rejects a webhook amount mismatch and leaves the local sale pending", async () => {
    const sale = await draftSale();
    const checkout = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/paymongo/checkout`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "paymongo-checkout-mismatch")
      .send({ method: "maya" });
    expect(checkout.status).toBe(201);

    const raw = JSON.stringify({
      data: {
        id: "evt_checkout_bad_amount",
        type: "checkout_session.payment.paid",
        data: {
          id: checkout.body.checkoutSessionId,
          attributes: {
            reference_number: sale.id,
            metadata: { businessId, saleId: sale.id, method: "maya" },
            payments: [{ attributes: { status: "paid", amount: sale.totalMinor - 1, source: { type: "paymaya" } } }],
          },
        },
      },
    });
    const webhook = await request(app.getHttpServer()).post("/api/v1/payments/paymongo/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", "valid")
      .send(raw);
    expect(webhook.status).toBe(400);
    expect(webhook.body.code).toBe("PAYMENT_TOTAL_MISMATCH");

    const pending = await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie);
    expect(pending.body.status).toBe("PENDING_PAYMENT");
    expect(pending.body.payments[0].status).toBe("PENDING");
  });
});

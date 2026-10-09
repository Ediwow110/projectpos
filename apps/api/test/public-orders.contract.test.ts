import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";
import type { PayMongoCheckoutInput, PayMongoCheckoutResult, PayMongoCheckoutSnapshot, PayMongoPort } from "../src/payments/paymongo";
import type { TransactionalEmailPort } from "../src/email/email.service";

class FakePayMongo implements PayMongoPort {
  configured(): boolean { return true; }
  async createCheckout(input: PayMongoCheckoutInput): Promise<PayMongoCheckoutResult> {
    return { sessionId: "cs_" + input.saleId, checkoutUrl: "https://checkout.test/" + input.saleId };
  }
  async retrieveCheckout(sessionId: string): Promise<PayMongoCheckoutSnapshot> {
    return { sessionId, checkoutUrl: "https://checkout.test/" + sessionId, status: "active", paid: false };
  }
  verifyWebhook(): boolean { return true; }
}

let app: INestApplication;
let db: DbPort;
let businessId: string;
let branchId: string;
let productId: string;
const storefrontKey = "0123456789abcdef0123456789abcdef";
const sent: Array<{ token: string; event: string }> = [];
const email: TransactionalEmailPort = {
  async sendPasswordReset() {}, async sendEmailVerification() {}, async sendReceiptShare() {},
  async sendOrderUpdate(input) { sent.push({ token: input.token, event: input.event }); },
};

beforeAll(async () => {
  process.env["WEB_URL"] = "https://pos.example.com";
  app = await createTestApp({ paymongo: new FakePayMongo(), email, completedOnboardingFixture: true });
  db = app.get("DbPort");
  const business = await db.createBusiness({ name: "Public Shop", currency: "PHP" });
  businessId = business.id;
  await db.setBusinessStorefrontKey(business.id, storefrontKey);
  const branch = await db.createBranch({ businessId, name: "Main", type: "store", isActive: true });
  branchId = branch.id;
  const product = await db.createProduct({
    businessId, categoryId: null, name: "Coffee", sku: "COF", barcode: null, brand: null, unit: "pc",
    costMinor: 100, priceMinor: 1000, taxRateBps: 1200, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  productId = product.id;
  await db.upsertBalance({ businessId, branchId, productId, qtyOnHand: 5 });
  await db.saveSettings(businessId, {
    onlineOrderingEnabled: true,
    onlinePickupBranchIds: [branchId],
    onlineFulfillmentBranchId: branchId,
    deliveryFlatFeeMinor: 200,
    taxRateBps: 1200,
  });
});
afterAll(async () => { await app.close(); delete process.env["WEB_URL"]; });

const origin = "https://pos.example.com";
function cookieFrom(res: request.Response): string {
  const rows = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (rows ?? []).map((row) => row.split(";")[0]).join("; ");
}

describe("phase22 public ordering", () => {
  it("exposes a redacted storefront and reservation-aware catalog", async () => {
    const storefront = await request(app.getHttpServer()).get("/api/v1/public/storefront?key=" + storefrontKey);
    expect(storefront.status).toBe(200);
    expect(storefront.body).toMatchObject({
      name: "Public Shop",
      currency: "PHP",
      deliveryAvailable: true,
      deliveryBranch: { id: branchId, name: "Main" },
    });
    expect(storefront.body).not.toHaveProperty("businessId");
    const catalog = await request(app.getHttpServer())
      .get("/api/v1/public/storefront/catalog?key=" + storefrontKey + "&branchId=" + branchId);
    expect(catalog.status).toBe(200);
    expect(catalog.body.items[0]).toMatchObject({ id: productId, name: "Coffee", priceMinor: 1000, availableToSell: 5 });
    expect(catalog.body.items[0]).not.toHaveProperty("costMinor");
  });

  it("creates a secure draft, server-reprices, submits pay-at-pickup, and resolves status by body token", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/public/orders")
      .set("Origin", origin).set("Idempotency-Key", "public-create-1")
      .send({ storefrontKey });
    expect(created.status).toBe(201);
    const setCookie = String(created.headers["set-cookie"]);
    expect(setCookie).toContain("nexpos_checkout=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=7200");
    const cookie = cookieFrom(created);

    const draft = await request(app.getHttpServer()).patch("/api/v1/public/orders/" + created.body.id + "/draft")
      .set("Origin", origin).set("Cookie", cookie)
      .send({ branchId, fulfillmentMode: "PICKUP", lines: [{ productId, qty: 2 }] });
    expect(draft.status).toBe(200);

    await db.updateProduct(productId, businessId, { priceMinor: 1200 });
    const submit = await request(app.getHttpServer()).post("/api/v1/public/orders/" + created.body.id + "/submit")
      .set("Origin", origin).set("Cookie", cookie).set("Idempotency-Key", "public-submit-1")
      .send({
        branchId, fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
        contactName: " Ana ", email: "ANA@EXAMPLE.COM", phone: "+63 (917) 123-4567",
      });
    expect(submit.status).toBe(200);
    expect(submit.body.order).toMatchObject({ status: "SUBMITTED", customerId: null, saleId: null, subtotalMinor: 2400 });
    expect(submit.body.statusToken).toEqual(expect.any(String));
    expect(sent.at(-1)?.token).toBe(submit.body.statusToken);
    const lines = await db.listOrderLines(created.body.id, businessId);
    expect(lines[0]).toMatchObject({ priceMinor: 1200, qty: 2 });

    const status = await request(app.getHttpServer()).post("/api/v1/public/orders/status")
      .send({ token: submit.body.statusToken });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ id: created.body.id, status: "SUBMITTED", paymentStatus: "UNPAID" });
    expect(status.body).not.toHaveProperty("email");
    expect(status.body).not.toHaveProperty("phone");
  });

  it("requires prepaid delivery and creates one linked PayMongo Sale for prepaid pickup", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/public/orders")
      .set("Origin", origin).set("Idempotency-Key", "public-create-2")
      .send({ storefrontKey });
    const cookie = cookieFrom(created);
    await request(app.getHttpServer()).patch("/api/v1/public/orders/" + created.body.id + "/draft")
      .set("Origin", origin).set("Cookie", cookie)
      .send({ branchId, fulfillmentMode: "PICKUP", lines: [{ productId, qty: 1 }] });

    const bad = await request(app.getHttpServer()).post("/api/v1/public/orders/" + created.body.id + "/submit")
      .set("Origin", origin).set("Cookie", cookie).set("Idempotency-Key", "public-submit-bad")
      .send({
        branchId, fulfillmentMode: "DELIVERY", paymentMode: "PAY_AT_PICKUP",
        contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
        deliveryAddress: { line1: "1 Main", city: "Cavite", region: "Cavite", postalCode: "4100", countryCode: "PH" },
      });
    expect(bad.status).toBe(400);

    const good = await request(app.getHttpServer()).post("/api/v1/public/orders/" + created.body.id + "/submit")
      .set("Origin", origin).set("Cookie", cookie).set("Idempotency-Key", "public-submit-2")
      .send({
        branchId, fulfillmentMode: "PICKUP", paymentMode: "PREPAID", paymentMethod: "card",
        contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      });
    expect(good.status).toBe(200);
    expect(good.body.checkoutUrl).toContain("https://checkout.test/");
    expect(good.body.order.saleId).toEqual(expect.any(String));
    expect((await db.findSaleById(good.body.order.saleId, businessId))?.status).toBe("PENDING_PAYMENT");

    const sale = (await db.findSaleById(good.body.order.saleId, businessId))!;
    const payments = await db.listPaymentsBySale(sale.id, businessId);
    const payment = payments[0]!;
    const sentBeforeConfirm = sent.length;
    const raw = JSON.stringify({
      data: {
        id: "evt_public_paid_1",
        type: "checkout_session.payment.paid",
        data: {
          id: payment.providerRef,
          type: "checkout_session",
          attributes: {
            reference_number: sale.id,
            metadata: { businessId, saleId: sale.id, receiptNo: sale.receiptNo, method: "card" },
            payments: [{ attributes: { status: "paid", amount: sale.totalMinor, currency: "PHP", source: { type: "card" } } }],
          },
        },
      },
    });
    const confirmed = await request(app.getHttpServer()).post("/api/v1/payments/paymongo/webhook")
      .set("Content-Type", "application/json").set("Paymongo-Signature", "valid").send(raw);
    expect(confirmed.status).toBe(200);
    expect((await db.findOrderById(good.body.order.id, businessId))?.status).toBe("CONFIRMED");
    expect(sent.slice(sentBeforeConfirm).filter((row) => row.event === "CONFIRMED")).toHaveLength(1);

    const duplicate = await request(app.getHttpServer()).post("/api/v1/payments/paymongo/webhook")
      .set("Content-Type", "application/json").set("Paymongo-Signature", "valid").send(raw);
    expect(duplicate.status).toBe(200);
    expect(sent.slice(sentBeforeConfirm).filter((row) => row.event === "CONFIRMED")).toHaveLength(1);

    const oldStatus = await request(app.getHttpServer()).post("/api/v1/public/orders/status")
      .send({ token: good.body.statusToken });
    expect(oldStatus.status).toBe(200);
    expect(oldStatus.body.status).toBe("CONFIRMED");

    const retryAfterConfirm = await request(app.getHttpServer()).post("/api/v1/public/orders/" + good.body.order.id + "/payment/retry")
      .set("Origin", origin).set("Cookie", cookie).set("Idempotency-Key", "retry-after-confirm")
      .send({ paymentMethod: "card" });
    expect(retryAfterConfirm.status).toBe(404);
  });
});

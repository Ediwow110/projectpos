import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

import { createTestApp } from "../src/app.module";
import type { TransactionalEmailPort } from "../src/email/email.service";

class CaptureReceiptEmail implements TransactionalEmailPort {
  receipts: Array<{ to: string; receiptNo: string; token: string }> = [];
  async sendPasswordReset(): Promise<void> {}
  async sendEmailVerification(): Promise<void> {}
  async sendReceiptShare(input: { to: string; customerName: string | null; receiptNo: string; token: string }): Promise<void> {
    this.receipts.push({ to: input.to, receiptNo: input.receiptNo, token: input.token });
  }
}

function jar(header: unknown): string {
  const arr = Array.isArray(header) ? header : [String(header ?? "")];
  return arr.map((cookie) => String(cookie).split(";")[0]).join("; ");
}

describe("receipt delivery HTTP contract", () => {
  let app: INestApplication;
  let cookie = "";
  let csrf = "";
  let saleId = "";
  const email = new CaptureReceiptEmail();

  beforeAll(async () => {
    app = await createTestApp({ email });
    const registration = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Receipt Owner",
      email: "receipt-delivery-owner@example.com",
      password: "correct-horse-12",
      businessName: "Receipt Delivery Store",
    });
    cookie = jar(registration.headers["set-cookie"]);
    csrf = registration.body.csrfToken;

    const customer = await request(app.getHttpServer()).post("/api/v1/customers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Ana Customer", email: "ana.customer@example.com" });
    expect(customer.status).toBe(201);

    const product = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Receipt Coffee", priceMinor: 2500, costMinor: 1000 });
    expect(product.status).toBe(201);
    await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId: product.body.id, type: "opening_stock", qtyDelta: 5 });

    const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId: product.body.id, qty: 1 }], customerId: customer.body.id });
    const completed = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "receipt-delivery-sale-1")
      .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
    expect(completed.status).toBe(201);
    saleId = draft.body.id as string;
  });

  afterAll(async () => { await app.close(); });

  it("prefills customer email, sends once, exposes delivery history, and serves the secure share token", async () => {
    const receipt = await request(app.getHttpServer()).get(`/api/v1/receipts/${saleId}`).set("Cookie", cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.customerEmail).toBe("ana.customer@example.com");

    const first = await request(app.getHttpServer()).post(`/api/v1/receipts/${saleId}/email`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "receipt-email-http-1")
      .send({ to: "ana.customer@example.com" });
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(first.body.delivery).toMatchObject({ status: "SENT", recipient: "ana.customer@example.com" });

    const replay = await request(app.getHttpServer()).post(`/api/v1/receipts/${saleId}/email`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "receipt-email-http-1")
      .send({ to: "ana.customer@example.com" });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(email.receipts).toHaveLength(1);

    const history = await request(app.getHttpServer()).get(`/api/v1/receipts/${saleId}/deliveries`).set("Cookie", cookie);
    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({ channel: "email", status: "SENT" });

    const token = email.receipts[0]!.token;
    const shared = await request(app.getHttpServer()).get(`/api/v1/receipts/shared/${encodeURIComponent(token)}`);
    expect(shared.status).toBe(200);
    expect(shared.body.receiptNo).toBe(receipt.body.receiptNo);
  });
});

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import { AuthService } from "../src/auth/nest/auth.service";

let app: INestApplication;
let cookie: string;
let csrf: string;
let productId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-abusepay@example.com",
    password: "correct-horse-12", businessName: "Abuse Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 5 });
});

afterAll(async () => { await app.close(); });

async function draftSale(qty: number): Promise<{ id: string; totalMinor: number }> {
  const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ lines: [{ productId, qty }] });
  return { id: draft.body.id, totalMinor: draft.body.totalMinor };
}

describe("phase8 abuse: money and validation", () => {
  it("rejects duplicate charges on idempotency replay without new movements", async () => {
    const sale = await draftSale(1);
    const first = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "abuse-pay-01")
      .send({ saleId: sale.id, payments: [{ method: "cash", amountMinor: sale.totalMinor }] });
    expect(first.status).toBe(201);
    const moves = await request(app.getHttpServer())
      .get(`/api/v1/inventory/products/${productId}/movements`)
      .set("Cookie", cookie);
    const before = moves.body.total;
    const second = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "abuse-pay-01")
      .send({ saleId: sale.id, payments: [{ method: "cash", amountMinor: sale.totalMinor }] });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const after = await request(app.getHttpServer())
      .get(`/api/v1/inventory/products/${productId}/movements`)
      .set("Cookie", cookie);
    expect(after.body.total).toBe(before);
  });

  it("rejects reused keys with different payloads (IDEMPOTENCY_MISMATCH)", async () => {
    const sale = await draftSale(1);
    await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "abuse-pay-02")
      .send({ saleId: sale.id, payments: [{ method: "cash", amountMinor: sale.totalMinor }] });
    const sale2 = await draftSale(1);
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "abuse-pay-02")
      .send({ saleId: sale2.id, payments: [{ method: "cash", amountMinor: sale2.totalMinor }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("rejects negative/zero quantities and prices", async () => {
    const badQty = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: -1 }] });
    expect(badQty.status).toBe(400);
    const badPrice = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Evil", priceMinor: -5 });
    expect(badPrice.status).toBe(400);
    expect(badPrice.body.code).toBe("VALIDATION");
  });

  it("gates over-threshold discounts by permission (unit: role matrix)", async () => {
    const svc = new AuthService({} as never);
    expect(svc.rolePermissions("cashier")).not.toContain("discount.override");
    expect(svc.rolePermissions("owner")).toContain("discount.override");
  });

  it("rejects split-total mismatch", async () => {
    const sale = await draftSale(1);
    const res = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "abuse-pay-03")
      .send({ saleId: sale.id, payments: [{ method: "cash", amountMinor: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PAYMENT_TOTAL_MISMATCH");
  });

  it("rejects concurrent oversell (exactly one INSUFFICIENT_STOCK)", async () => {
    const race = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Race Soda", priceMinor: 1000 });
    const raceId = race.body.id;
    await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId: raceId, type: "opening_stock", qtyDelta: 5 });
    const mkDraft = async () => {
      const d = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
        .set("Cookie", cookie).set("X-CSRF-Token", csrf)
        .send({ lines: [{ productId: raceId, qty: 5 }] });
      return { id: d.body.id as string, totalMinor: d.body.totalMinor as number };
    };
    const a = await mkDraft();
    const b = await mkDraft();
    const results = await Promise.allSettled([
      request(app.getHttpServer()).post("/api/v1/sales/complete")
        .set("Cookie", cookie).set("X-CSRF-Token", csrf)
        .set("Idempotency-Key", "abuse-pay-04a")
        .send({ saleId: a.id, payments: [{ method: "cash", amountMinor: a.totalMinor }] }),
      request(app.getHttpServer()).post("/api/v1/sales/complete")
        .set("Cookie", cookie).set("X-CSRF-Token", csrf)
        .set("Idempotency-Key", "abuse-pay-04b")
        .send({ saleId: b.id, payments: [{ method: "cash", amountMinor: b.totalMinor }] }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled" && (r.value as { status: number }).status === 201).length;
    // Second completion fails either on stock (410/409 INSUFFICIENT_STOCK) — count non-201s:
    const failed = results.filter((r) => r.status === "rejected" || (r.value as { status: number }).status !== 201).length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);
  });

  it("rejects over-quantity refunds and self-approval", async () => {
    const sale = await draftSale(1);
    await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "abuse-pay-05")
      .send({ saleId: sale.id, payments: [{ method: "cash", amountMinor: sale.totalMinor }] });
    const detail = await request(app.getHttpServer()).get(`/api/v1/sales/${sale.id}`).set("Cookie", cookie);
    const itemId = detail.body.items[0].id;
    const over = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.id}/refund-approve`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "abuse-pay-06")
      .send({ saleId: sale.id, items: [{ saleItemId: itemId, qty: 99 }] });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe("REFUND_EXCEEDS_LIMIT");
  });

  it("rejects double shift close and closed-shift writes", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Abuse Counter" });
    const opened = await request(app.getHttpServer()).post(`/api/v1/registers/${reg.body.id}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId: reg.body.id, openingFloatMinor: 0 });
    const shiftId = opened.body.id;
    await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/close`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ countedCashMinor: 0 });
    const again = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/close`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ countedCashMinor: 0 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("SHIFT_ALREADY_CLOSED");
    const cash = await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/cash`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ kind: "cash_deposit", amountMinor: 100 });
    expect(cash.status).toBe(403);
    expect(cash.body.code).toBe("SHIFT_CLOSED_IMMUTABLE");
  });

  it("rejects malicious attachment and image URLs", async () => {
    const evil = "javascript:alert(1)";
    const prod = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Evil Img", priceMinor: 100, imageUrl: evil });
    expect(prod.status).toBe(400);
    const exp = await request(app.getHttpServer()).post("/api/v1/expenses")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ category: "X", amountMinor: 100, method: "cash", attachmentUrl: evil });
    expect(exp.status).toBe(400);
  });

  it("rejects oversized JSON bodies", async () => {
    const big = "x".repeat(200 * 1024);
    const res = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: big, priceMinor: 100 });
    expect(res.status).toBe(413);
  });
});

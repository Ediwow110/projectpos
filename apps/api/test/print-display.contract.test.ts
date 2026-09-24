import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let businessId: string;
let productId: string;
let receiptNo: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-print@example.com",
    password: "correct-horse-12", businessName: "Print Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const me = await request(app.getHttpServer()).get("/api/v1/business")
    .set("Cookie", cookie);
  businessId = me.body.id;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "opening_stock", qtyDelta: 50 });
  const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ lines: [{ productId, qty: 1 }] });
  const complete = await request(app.getHttpServer()).post("/api/v1/sales/complete")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", "print-sale-1")
    .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
  receiptNo = complete.body.receiptNo;
});

afterAll(async () => { await app.close(); });

describe("phase10 printers and display HTTP contract", () => {
  it("enrolls a printer, queues a job, and fulfills it once", async () => {
    const enrolled = await request(app.getHttpServer()).post("/api/v1/printers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter printer", width: "58" });
    expect(enrolled.status).toBe(201);
    const printerId = enrolled.body.id as string;
    const queued = await request(app.getHttpServer()).post("/api/v1/print-jobs")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ printerId, receiptNo });
    expect(queued.status).toBe(201);
    expect(queued.body.status).toBe("QUEUED");
    const next = await request(app.getHttpServer())
      .get(`/api/v1/print-jobs/next?printerId=${printerId}`)
      .set("Cookie", cookie);
    expect(next.status).toBe(200);
    expect(next.body.status).toBe("SENT");
    expect(next.body.attempts).toBe(1);
    const payload = Buffer.from(next.body.payload as string, "base64");
    expect(payload[0]).toBe(0x1b);
    expect(payload[1]).toBe(0x40);
    expect(payload.toString("ascii")).toContain("Print Store");
    const empty = await request(app.getHttpServer())
      .get(`/api/v1/print-jobs/next?printerId=${printerId}`)
      .set("Cookie", cookie);
    expect(empty.status).toBe(404);
    expect(empty.body.code).toBe("NOT_FOUND");
  });
  it("rejects print jobs for unknown printers and receipts", async () => {
    const badPrinter = await request(app.getHttpServer()).post("/api/v1/print-jobs")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ printerId: "prt_missing" });
    expect(badPrinter.status).toBe(404);
    const enrolled = await request(app.getHttpServer()).post("/api/v1/printers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Back printer" });
    const badReceipt = await request(app.getHttpServer()).post("/api/v1/print-jobs")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ printerId: enrolled.body.id, receiptNo: "2099-999999" });
    expect(badReceipt.status).toBe(404);
  });
  it("serves the customer display feed on a short-lived token", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/registers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Counter 1" });
    const registerId = reg.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/registers/${registerId}/open`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId, openingFloatMinor: 0 });
    const saleDraft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }], registerId });
    const saleDone = await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "display-sale-1")
      .send({ saleId: saleDraft.body.id, registerId, payments: [{ method: "cash", amountMinor: saleDraft.body.totalMinor }] });
    expect(saleDone.status).toBe(201);
    const minted = await request(app.getHttpServer()).post("/api/v1/display/tokens")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ registerId });
    expect(minted.status).toBe(201);
    expect(typeof minted.body.token).toBe("string");
    const feed = await request(app.getHttpServer())
      .get(`/api/v1/display/${registerId}?token=${minted.body.token}&businessId=${businessId}`);
    expect(feed.status).toBe(200);
    expect(feed.body.businessName).toBe("Print Store");
    expect(feed.body.lastSale.receiptNo).toBe(saleDone.body.receiptNo);
    const bad = await request(app.getHttpServer())
      .get(`/api/v1/display/${registerId}?token=nope&businessId=${businessId}`);
    expect(bad.status).toBe(404);
  });
  it("returns NOT_FOUND for another tenant's printer", async () => {
    const reg2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-print@example.com",
      password: "correct-horse-12", businessName: "Other Print Store",
    });
    const other = jar(reg2.headers["set-cookie"]);
    const otherCsrf = reg2.body.csrfToken as string;
    const got = await request(app.getHttpServer()).post("/api/v1/print-jobs")
      .set("Cookie", other).set("X-CSRF-Token", otherCsrf)
      .send({ printerId: "prt_missing" });
    expect(got.status).toBe(404);
  });
});

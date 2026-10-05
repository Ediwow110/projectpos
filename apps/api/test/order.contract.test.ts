import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

let app: INestApplication;
let db: DbPort;
let cookie: string;
let csrf: string;
let businessId: string;
let branchA: { id: string };
let branchB: { id: string };
let orderA: { id: string };
let orderB: { id: string };

function jar(header: unknown): string {
  const rows = Array.isArray(header) ? header : [String(header ?? "")];
  return rows.map((row) => String(row).split(";")[0]).join("; ");
}

async function createOrder(branchId: string, requestId: string) {
  const now = new Date();
  return db.createOrder({
    businessId, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
    taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
    version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
    actorId: "public:test", requestId, createdAt: now, updatedAt: now,
  });
}

beforeAll(async () => {
  app = await createTestApp();
  db = app.get("DbPort");
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-orders@example.com", password: "correct-horse-12", businessName: "Order Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  businessId = reg.body.business.id;
  branchA = await db.createBranch({ businessId, name: "Main", type: "store", isActive: true });
  branchB = await db.createBranch({ businessId, name: "Back", type: "store", isActive: true });
  orderA = await createOrder(branchA.id, "order-a");
  orderB = await createOrder(branchB.id, "order-b");
});

afterAll(async () => { await app.close(); });

describe("phase22 staff Order HTTP reads", () => {
  it("paginates a bounded list and rejects invalid limits", async () => {
    const first = await request(app.getHttpServer()).get("/api/v1/orders?limit=1").set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(first.body.items[0].paymentStatus).toBe("UNPAID");

    const second = await request(app.getHttpServer())
      .get("/api/v1/orders?limit=1&cursor=" + encodeURIComponent(first.body.nextCursor))
      .set("Cookie", cookie);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);

    const invalid = await request(app.getHttpServer()).get("/api/v1/orders?limit=101").set("Cookie", cookie);
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("VALIDATION");
  });

  it("enforces active-branch scope on list and detail", async () => {
    const scoped = await request(app.getHttpServer()).post("/api/v1/me/active-branch")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ branchId: branchA.id });
    expect(scoped.status).toBe(200);

    const list = await request(app.getHttpServer()).get("/api/v1/orders").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((row: { id: string }) => row.id)).toEqual([orderA.id]);

    const foreignFilter = await request(app.getHttpServer())
      .get("/api/v1/orders?branchId=" + encodeURIComponent(branchB.id)).set("Cookie", cookie);
    expect(foreignFilter.status).toBe(403);

    const foreignDetail = await request(app.getHttpServer()).get("/api/v1/orders/" + orderB.id).set("Cookie", cookie);
    expect(foreignDetail.status).toBe(404);
  });

  it("rejects unauthenticated staff Order reads", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/orders");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});

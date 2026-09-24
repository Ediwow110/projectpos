import { createHmac } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import { canonicalWebhookBody } from "../src/billing/nest/billing.service";

let app: INestApplication;
let cookie: string;
let csrf: string;
let businessId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

function sign(body: unknown): string {
  return createHmac("sha256", "test-webhook-secret").update(canonicalWebhookBody(body)).digest("hex");
}

beforeAll(async () => {
  app = await createTestApp();
  process.env["PLATFORM_API_KEY"] = "test-platform-key";
  process.env["BILLING_TEST_DOUBLE_SECRET"] = "test-webhook-secret";
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-webhook@example.com",
    password: "correct-horse-12", businessName: "Webhook Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const me = await request(app.getHttpServer()).get("/api/v1/business")
    .set("Cookie", cookie);
  businessId = me.body.id;
});

afterAll(async () => { await app.close(); });

describe("phase10 webhook HTTP contract", () => {
  it("applies each eventId once and replays idempotently", async () => {
    const issued = await request(app.getHttpServer()).post("/api/v1/platform/invoices/issue")
      .set("x-platform-key", "test-platform-key")
      .send({ businessId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" });
    expect(issued.status).toBe(201);
    const body = { eventId: "evt-1", type: "invoice.paid", businessId, amountMinor: 149000 };
    const first = await request(app.getHttpServer()).post("/api/v1/billing/webhooks/test-double")
      .set("x-webhook-signature", sign(body))
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.handled).toBe(true);
    const list = await request(app.getHttpServer()).get("/api/v1/billing/invoices")
      .set("Cookie", cookie);
    expect(list.body.items[0].status).toBe("paid");
    const replay = await request(app.getHttpServer()).post("/api/v1/billing/webhooks/test-double")
      .set("x-webhook-signature", sign(body))
      .send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    const again = await request(app.getHttpServer()).get("/api/v1/billing/invoices")
      .set("Cookie", cookie);
    expect(again.body.items.length).toBe(1);
  });
  it("rejects bad signatures and acks unknown types", async () => {
    const bad = await request(app.getHttpServer()).post("/api/v1/billing/webhooks/test-double")
      .set("x-webhook-signature", "deadbeef")
      .send({ eventId: "evt-bad", type: "invoice.paid" });
    expect(bad.status).toBe(403);
    const unknownBody = { eventId: "evt-unknown", type: "planets.aligned" };
    const unknown = await request(app.getHttpServer()).post("/api/v1/billing/webhooks/test-double")
      .set("x-webhook-signature", sign(unknownBody))
      .send(unknownBody);
    expect(unknown.status).toBe(200);
    expect(unknown.body.handled).toBe(false);
  });
});

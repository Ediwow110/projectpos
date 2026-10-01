import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let ownerCookie: string;
let ownerCsrf: string;
let cashierCookie: string;
let cashierCsrf: string;
let productId: string;

function jar(headers: unknown): string {
  const values = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return values.map((header) => String(header).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
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
});

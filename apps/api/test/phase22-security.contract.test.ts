import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";
import { AuthService } from "../src/auth/nest/auth.service";
import { OrderAccessService } from "../src/orders/order-access-service";
import { OrderService } from "../src/orders/order-service";

const ORIGIN = "https://pos.example.com";
const STOREFRONT_A = "11111111111111111111111111111111";
const STOREFRONT_B = "22222222222222222222222222222222";

let app: INestApplication;
let db: DbPort;
let businessA: { id: string };
let businessB: { id: string };
let branchA: { id: string };
let branchB: { id: string };
let ownerCookie: string;

function jar(header: unknown): string {
  const rows = Array.isArray(header) ? header : [String(header ?? "")];
  return rows.map((row) => String(row).split(";")[0]).join("; ");
}

function checkoutCookie(res: request.Response): string {
  const rows = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (rows ?? []).map((row) => row.split(";")[0]).join("; ");
}

async function orderFor(businessId: string, branchId: string, requestId: string) {
  const now = new Date("2026-10-06T12:00:00.000Z");
  return db.createOrder({
    businessId, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: "Call on arrival", currency: "PHP",
    subtotalMinor: 100, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0,
    totalMinor: 100, saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now,
    confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public", requestId,
    createdAt: now, updatedAt: now,
  });
}

beforeAll(async () => {
  process.env["WEB_URL"] = ORIGIN;
  app = await createTestApp({ completedOnboardingFixture: true });
  db = app.get("DbPort");
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Owner A",
    email: "phase22-security-owner@example.com",
    password: "correct-horse-12",
    businessName: "Tenant A",
  });
  expect(reg.status).toBe(201);
  businessA = { id: reg.body.business.id };
  ownerCookie = jar(reg.headers["set-cookie"]);
  await db.setBusinessStorefrontKey(businessA.id, STOREFRONT_A);
  branchA = await db.createBranch({ businessId: businessA.id, name: "A Main", type: "store", isActive: true });
  await db.saveSettings(businessA.id, {
    ...await db.getSettings(businessA.id),
    onlineOrderingEnabled: true,
    onlinePickupBranchIds: [branchA.id],
    onlineFulfillmentBranchId: branchA.id,
    deliveryFlatFeeMinor: 0,
  });

  const second = await db.createBusiness({ name: "Tenant B", currency: "PHP" });
  businessB = { id: second.id };
  await db.setBusinessStorefrontKey(businessB.id, STOREFRONT_B);
  branchB = await db.createBranch({ businessId: businessB.id, name: "B Main", type: "store", isActive: true });
  await db.saveSettings(businessB.id, {
    onlineOrderingEnabled: true,
    onlinePickupBranchIds: [branchB.id],
    onlineFulfillmentBranchId: branchB.id,
    deliveryFlatFeeMinor: 0,
  });
});

afterAll(async () => {
  await app.close();
  delete process.env["WEB_URL"];
});

describe("phase22 security and redaction contract", () => {
  it("requires the exact configured Origin for cookie-auth public mutations", async () => {
    const missing = await request(app.getHttpServer()).post("/api/v1/public/orders")
      .set("Idempotency-Key", "security-origin-missing")
      .send({ storefrontKey: STOREFRONT_A });
    expect(missing.status).toBe(403);

    const wrong = await request(app.getHttpServer()).post("/api/v1/public/orders")
      .set("Origin", "https://evil.example.com")
      .set("Idempotency-Key", "security-origin-wrong")
      .send({ storefrontKey: STOREFRONT_A });
    expect(wrong.status).toBe(403);

    const exact = await request(app.getHttpServer()).post("/api/v1/public/orders")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", "security-origin-exact")
      .send({ storefrontKey: STOREFRONT_A });
    expect(exact.status).toBe(201);
    expect(exact.body).not.toHaveProperty("checkoutToken");
    expect(String(exact.headers["set-cookie"])).toContain("HttpOnly");
  });

  it("rejects cross-business storefront branch use and cross-tenant staff detail access", async () => {
    const catalog = await request(app.getHttpServer())
      .get("/api/v1/public/storefront/catalog?key=" + STOREFRONT_A + "&branchId=" + branchB.id);
    expect(catalog.status).toBe(400);
    expect(catalog.body.code).toBe("VALIDATION");

    const foreignOrder = await orderFor(businessB.id, branchB.id, "foreign-order");
    const detail = await request(app.getHttpServer())
      .get("/api/v1/orders/" + foreignOrder.id)
      .set("Cookie", ownerCookie);
    expect(detail.status).toBe(404);
  });

  it("scopes checkout and status tokens to the intended Order and keeps status lookup body-only", async () => {
    const first = await request(app.getHttpServer()).post("/api/v1/public/orders")
      .set("Origin", ORIGIN).set("Idempotency-Key", "security-create-first")
      .send({ storefrontKey: STOREFRONT_A });
    const second = await request(app.getHttpServer()).post("/api/v1/public/orders")
      .set("Origin", ORIGIN).set("Idempotency-Key", "security-create-second")
      .send({ storefrontKey: STOREFRONT_A });
    const cookie = checkoutCookie(first);
    const cross = await request(app.getHttpServer()).patch("/api/v1/public/orders/" + second.body.id + "/draft")
      .set("Origin", ORIGIN).set("Cookie", cookie)
      .send({ branchId: branchA.id, fulfillmentMode: "PICKUP", lines: [{ productId: "missing", qty: 1 }] });
    expect(cross.status).toBe(404);

    const direct = await orderFor(businessA.id, branchA.id, "status-scope-a");
    const other = await orderFor(businessA.id, branchA.id, "status-scope-b");
    const access = new OrderAccessService(db);
    const minted = await access.mintStatusToken(businessA.id, direct.id);
    await expect(access.authenticate(minted.token, "STATUS", other.id)).rejects.toThrow("NOT_FOUND");

    const status = await request(app.getHttpServer()).post("/api/v1/public/orders/status")
      .send({ token: minted.token });
    expect(status.status).toBe(200);
    expect(status.body.id).toBe(direct.id);
    expect(status.body).not.toHaveProperty("email");
    expect(status.body).not.toHaveProperty("phone");
    expect(status.body).not.toHaveProperty("deliveryAddress");
    expect(JSON.stringify(status.body)).not.toContain(minted.token);

    const queryAttempt = await request(app.getHttpServer())
      .get("/api/v1/public/orders/status?token=" + encodeURIComponent(minted.token));
    expect(queryAttempt.status).toBe(404);
  });

  it("keeps the seeded staff Order permission matrix least-privilege", () => {
    const auth = app.get(AuthService);
    expect(auth.rolePermissions("owner")).toEqual(expect.arrayContaining([
      "order.view", "order.accept", "order.cancel", "order.fulfill", "order.collect",
      "order.view_delivery_details", "order.link_customer", "order.manage_access",
    ]));
    expect(auth.rolePermissions("manager")).toEqual(expect.arrayContaining([
      "order.view", "order.cancel", "order.fulfill", "order.collect", "order.manage_access",
    ]));
    expect(auth.rolePermissions("cashier")).toEqual(expect.arrayContaining(["order.view", "order.accept", "order.collect"]));
    expect(auth.rolePermissions("cashier")).not.toEqual(expect.arrayContaining(["order.cancel", "order.fulfill", "order.manage_access"]));
    expect(auth.rolePermissions("inventory")).toEqual(expect.arrayContaining(["order.view", "order.fulfill", "order.view_delivery_details"]));
    expect(auth.rolePermissions("inventory")).not.toEqual(expect.arrayContaining(["order.accept", "order.collect", "order.manage_access"]));
  });

  it("records an owner CRM mismatch override reason without changing the immutable contact snapshot", async () => {
    const order = await orderFor(businessA.id, branchA.id, "crm-audit");
    const customer = await db.createCustomer({
      businessId: businessA.id,
      name: "Different Customer",
      phone: "09170000000",
      email: "different@example.com",
      address: null,
      notes: null,
      isActive: true,
    });
    const linked = await app.get(OrderService).linkCustomer(
      businessA.id,
      "owner-user",
      "crm-audit-request",
      order.id,
      customer.id,
      order.version,
      "owner",
      "crm-audit-key",
      "Verified government ID at counter",
    );
    expect(linked.customerId).toBe(customer.id);
    expect(linked.email).toBe("ana@example.com");
    expect(linked.phone).toBe("+639171234567");
    const audit = (await db.listAuditFor(businessA.id, "Order", order.id))
      .find((entry) => entry.action === "order.link_customer");
    expect(audit).toMatchObject({
      reason: "Verified government ID at counter",
      after: { customerId: customer.id, matched: false },
    });
  });
});

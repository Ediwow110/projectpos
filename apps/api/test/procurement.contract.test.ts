import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

let app: INestApplication;
let ownerCookie: string;
let ownerCsrf: string;
let cashierCookie: string;
let cashierCsrf: string;
let supplierId: string;
let otherSupplierId: string;
let productA: string;
let productB: string;
let purchaseOrderId: string;
let purchaseOrderVersion = 1;
let foreignCookie: string;
let businessId: string;

function jar(headers: unknown): string {
  const values = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return values.map((header) => String(header).split(";")[0]).join("; ");
}

function api(method: "get" | "post" | "patch", path: string, cookie: string, csrf?: string) {
  const req = request(app.getHttpServer())[method](path).set("Cookie", cookie);
  if (csrf) req.set("X-CSRF-Token", csrf);
  return req;
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const suffix = Date.now();
  const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Procurement Owner",
    email: `procurement-owner-${suffix}@example.com`,
    password: "correct-horse-12",
    businessName: "Procurement Store",
  });
  expect(owner.status).toBe(201);
  ownerCookie = jar(owner.headers["set-cookie"]);
  ownerCsrf = owner.body.csrfToken as string;
  const me = await api("get", "/api/v1/me", ownerCookie);
  businessId = me.body.businessId as string;

  const firstProduct = await api("post", "/api/v1/products", ownerCookie, ownerCsrf)
    .send({ name: "Procurement Coffee", priceMinor: 2500, costMinor: 1000, sku: `proc-a-${suffix}` });
  const secondProduct = await api("post", "/api/v1/products", ownerCookie, ownerCsrf)
    .send({ name: "Procurement Tea", priceMinor: 1800, costMinor: 800, sku: `proc-b-${suffix}` });
  expect(firstProduct.status).toBe(201);
  expect(secondProduct.status).toBe(201);
  productA = firstProduct.body.id as string;
  productB = secondProduct.body.id as string;

  const memberships = await api("get", "/api/v1/memberships", ownerCookie);
  const invitation = await api("post", "/api/v1/memberships", ownerCookie, ownerCsrf)
    .send({ name: "Procurement Cashier", email: `procurement-cashier-${suffix}@example.com`, role: "cashier" });
  expect(invitation.status).toBe(201);
  const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({
    email: `procurement-cashier-${suffix}@example.com`,
    password: invitation.body.tempPassword,
  });
  expect(login.status).toBe(201);
  cashierCookie = jar(login.headers["set-cookie"]);
  cashierCsrf = login.body.csrfToken as string;
  expect(memberships.status).toBe(200);

  const foreign = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Foreign Owner",
    email: `procurement-foreign-${suffix}@example.com`,
    password: "correct-horse-12",
    businessName: "Foreign Store",
  });
  expect(foreign.status).toBe(201);
  foreignCookie = jar(foreign.headers["set-cookie"]);
});

afterAll(async () => {
  await app.close();
});

describe("phase16 procurement HTTP contract", () => {
  it("creates suppliers idempotently and rejects mismatched replays", async () => {
    const payload = { name: "  ACME Foods  ", code: " acme ", email: "orders@acme.test" };
    const created = await api("post", "/api/v1/suppliers", ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "supplier-create-1").send(payload);
    expect(created.status).toBe(201);
    expect(created.body.supplier).toMatchObject({ name: "ACME Foods", code: "ACME", isActive: true });
    supplierId = created.body.supplier.id as string;

    const other = await api("post", "/api/v1/suppliers", ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "supplier-create-2").send({ name: "Other Foods", code: "OTHER" });
    expect(other.status).toBe(201);
    otherSupplierId = other.body.supplier.id as string;

    const replay = await api("post", "/api/v1/suppliers", ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "supplier-create-1").send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, supplier: { id: supplierId } });

    const mismatch = await api("post", "/api/v1/suppliers", ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "supplier-create-1").send({ ...payload, name: "Different" });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("enforces cashier denial, tenant isolation, strict bodies, and invalid branches", async () => {
    const cashier = await api("post", "/api/v1/suppliers", cashierCookie, cashierCsrf)
      .set("Idempotency-Key", "cashier-supplier-1").send({ name: "Denied" });
    expect(cashier.status).toBe(403);
    expect(cashier.body.code).toBe("FORBIDDEN");

    const hiddenTotals = await api("post", "/api/v1/purchase-orders", ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "po-invalid-totals").send({ supplierId, lines: [], subtotalMinor: 999 });
    expect(hiddenTotals.status).toBe(400);
    expect(hiddenTotals.body.code).toBe("VALIDATION");

    const badBranch = await api("post", "/api/v1/purchase-orders", ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "po-invalid-branch").send({ supplierId, branchId: "branch_missing", lines: [] });
    expect(badBranch.status).toBe(400);
    expect(badBranch.body.code).toBe("VALIDATION");

    const foreignSupplier = await api("get", `/api/v1/suppliers/${supplierId}`, foreignCookie);
    expect(foreignSupplier.status).toBe(404);
    expect(foreignSupplier.body.code).toBe("NOT_FOUND");
  });

  it("maps products and preserves inventory while creating, editing, ordering, and cancelling a PO", async () => {
    const db = app.get<DbPort>("DbPort");
    const beforeMovements = await db.listMovementsByBusiness(businessId);
    const beforeBalances = await db.listBalances(businessId);

    const mapping = await api("post", `/api/v1/suppliers/${supplierId}/products`, ownerCookie, ownerCsrf)
      .send({ productId: productA, supplierSku: "ACME-COF", unitCostMinor: 125, isPreferred: true });
    expect(mapping.status).toBe(201);

    const wrongSupplierPath = await api("patch", `/api/v1/suppliers/${otherSupplierId}/products/${mapping.body.id}`, ownerCookie, ownerCsrf)
      .send({ supplierSku: "SHOULD-NOT-UPDATE" });
    expect(wrongSupplierPath.status).toBe(404);
    expect(wrongSupplierPath.body.code).toBe("NOT_FOUND");

    const created = await api("post", "/api/v1/purchase-orders", ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "po-create-1")
      .send({ supplierId, lines: [{ productId: productA, quantity: 2 }, { productId: productB, quantity: 1, unitCostMinor: 300 }] });
    expect(created.status).toBe(201);
    const order = created.body.purchaseOrder;
    purchaseOrderId = order.id as string;
    purchaseOrderVersion = order.version as number;
    expect(order).toMatchObject({ status: "DRAFT", subtotalMinor: 550, totalMinor: 550, poNumber: expect.stringMatching(/^PO-\d{4}-\d{6}$/) });
    expect(order.lines[0]).toMatchObject({ supplierSkuSnapshot: "ACME-COF", unitCostMinor: 125, lineTotalMinor: 250 });

    const replay = await api("post", "/api/v1/purchase-orders", ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "po-create-1")
      .send({ supplierId, lines: [{ productId: productA, quantity: 2 }, { productId: productB, quantity: 1, unitCostMinor: 300 }] });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);

    const edited = await api("patch", `/api/v1/purchase-orders/${purchaseOrderId}`, ownerCookie, ownerCsrf)
      .send({ expectedVersion: purchaseOrderVersion, notes: "Priority delivery", lines: [{ productId: productA, quantity: 3 }] });
    expect(edited.status).toBe(200);
    purchaseOrderVersion = edited.body.version as number;
    expect(edited.body).toMatchObject({ notes: "Priority delivery", subtotalMinor: 375, totalMinor: 375 });

    const stale = await api("patch", `/api/v1/purchase-orders/${purchaseOrderId}`, ownerCookie, ownerCsrf)
      .send({ expectedVersion: 1, notes: "stale" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_VERSION");

    const ordered = await api("post", `/api/v1/purchase-orders/${purchaseOrderId}/order`, ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "po-order-1").send({ expectedVersion: purchaseOrderVersion });
    expect(ordered.status).toBe(200);
    expect(ordered.body.purchaseOrder.status).toBe("ORDERED");
    purchaseOrderVersion = ordered.body.purchaseOrder.version as number;

    const orderReplay = await api("post", `/api/v1/purchase-orders/${purchaseOrderId}/order`, ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "po-order-1").send({ expectedVersion: 999 });
    expect(orderReplay.status).toBe(200);
    expect(orderReplay.body.replayed).toBe(true);

    const locked = await api("patch", `/api/v1/purchase-orders/${purchaseOrderId}`, ownerCookie, ownerCsrf)
      .send({ expectedVersion: purchaseOrderVersion, notes: "not allowed" });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe("PURCHASE_ORDER_INVALID_STATE");

    const cancelled = await api("post", `/api/v1/purchase-orders/${purchaseOrderId}/cancel`, ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "po-cancel-1").send({ expectedVersion: purchaseOrderVersion, reason: "No longer needed" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.purchaseOrder.status).toBe("CANCELLED");

    const cancelReplay = await api("post", `/api/v1/purchase-orders/${purchaseOrderId}/cancel`, ownerCookie, ownerCsrf)
      .set("Idempotency-Key", "po-cancel-1").send({ expectedVersion: 999, reason: "No longer needed" });
    expect(cancelReplay.status).toBe(200);
    expect(cancelReplay.body.replayed).toBe(true);

    const events = await api("get", `/api/v1/purchase-orders/${purchaseOrderId}/events`, ownerCookie);
    expect(events.status).toBe(200);
    expect(events.body.items.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining([
      "purchase_order.create", "purchase_order.update", "purchase_order.ordered", "purchase_order.cancelled",
    ]));

    expect(await db.listMovementsByBusiness(businessId)).toEqual(beforeMovements);
    expect(await db.listBalances(businessId)).toEqual(beforeBalances);
  });
});

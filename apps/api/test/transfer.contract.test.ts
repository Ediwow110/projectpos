import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;
let branchA: string;
let branchB: string;
let productId: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  process.env["PLATFORM_API_KEY"] = "test-platform-key";
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-transfer@example.com",
    password: "correct-horse-12", businessName: "Transfer Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  // Trial Pro has no branches allowance: upgrade to Enterprise like an operator would.
  const me = await request(app.getHttpServer()).get("/api/v1/business")
    .set("Cookie", cookie);
  const upgraded = await request(app.getHttpServer()).patch(`/api/v1/platform/businesses/${me.body.id}/plan`)
    .set("x-platform-key", "test-platform-key")
    .send({ planKey: "enterprise" });
  expect(upgraded.status).toBe(200);
  const a = await request(app.getHttpServer()).post("/api/v1/branches")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "North" });
  branchA = a.body.id;
  const b = await request(app.getHttpServer()).post("/api/v1/branches")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "South" });
  branchB = b.body.id;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500, costMinor: 1000 });
  productId = prod.body.id;
  await request(app.getHttpServer()).post("/api/v1/inventory/movements")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ productId, type: "receive", qtyDelta: 10, branchId: branchA });
});

afterAll(async () => { await app.close(); });

describe("phase9a transfer HTTP contract", () => {
  it("full lifecycle over HTTP with status transitions and embedded lines", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/transfers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ fromBranchId: branchA, toBranchId: branchB, lines: [{ productId, qty: 4 }] });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    const id = created.body.id as string;
    const dispatched = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/dispatch`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-dispatch-1")
      .send({});
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.transfer.status).toBe("IN_TRANSIT");
    const received = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/receive`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-receive-1")
      .send({});
    expect(received.status).toBe(200);
    expect(received.body.transfer.status).toBe("RECEIVED");
    const detail = await request(app.getHttpServer()).get(`/api/v1/transfers/${id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ productId, qty: 4 })]),
    );
  });
  it("rejects double dispatch with TRANSFER_INVALID_STATE", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/transfers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ fromBranchId: branchA, toBranchId: branchB, lines: [{ productId, qty: 1 }] });
    const id = created.body.id as string;
    const first = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/dispatch`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-double-1")
      .send({});
    expect(first.status).toBe(200);
    const second = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/dispatch`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-double-2")
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("TRANSFER_INVALID_STATE");
  });
  it("rejects unauthenticated access", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/transfers");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
});
describe("phase9a transfer edges", () => {
  it("rejects same-branch and unknown-branch transfers with VALIDATION", async () => {
    const same = await request(app.getHttpServer()).post("/api/v1/transfers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ fromBranchId: branchA, toBranchId: branchA, lines: [{ productId, qty: 1 }] });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe("VALIDATION");
    const unknown = await request(app.getHttpServer()).post("/api/v1/transfers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ fromBranchId: branchA, toBranchId: "br_missing", lines: [{ productId, qty: 1 }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("VALIDATION");
  });
  it("rejects receive-before-dispatch and cancel-after-receive", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/transfers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ fromBranchId: branchA, toBranchId: branchB, lines: [{ productId, qty: 1 }] });
    const id = created.body.id as string;
    const early = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/receive`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-edge-r1")
      .send({});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("TRANSFER_INVALID_STATE");
    const dispatched = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/dispatch`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-edge-d1")
      .send({});
    expect(dispatched.status).toBe(200);
    const received = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/receive`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-edge-r2")
      .send({});
    expect(received.status).toBe(200);
    const cancelled = await request(app.getHttpServer()).post(`/api/v1/transfers/${id}/cancel`)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-edge-c1")
      .send({});
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.code).toBe("TRANSFER_INVALID_STATE");
  });
  it("rejects cashier transfer writes (service-level gate)", async () => {
    const { createMemoryDb } = await import("../src/common/memory.db");
    const { TransferService } = await import("../src/transfers/nest/transfer.service");
    const svc = new TransferService(createMemoryDb());
    await expect(
      svc.createTransfer("b1", "u9", "r9", {
        fromBranchId: "a", toBranchId: "b", lines: [{ productId: "p", qty: 1 }],
      }, []),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("returns NOT_FOUND for another tenants transfer", async () => {
    const created = await request(app.getHttpServer()).post("/api/v1/transfers")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ fromBranchId: branchA, toBranchId: branchB, lines: [{ productId, qty: 1 }] });
    const id = created.body.id as string;
    const reg2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-transfer@example.com",
      password: "correct-horse-12", businessName: "Other Transfer Store",
    });
    const other = jar(reg2.headers["set-cookie"]);
    const got = await request(app.getHttpServer()).get(`/api/v1/transfers/${id}`)
      .set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });
  it("compares branches in the report view", async () => {
    await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId, type: "receive", qtyDelta: 50, branchId: branchA });
    await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId, type: "receive", qtyDelta: 50, branchId: branchB });
    const draftA = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 1 }], branchId: branchA });
    expect(draftA.status).toBe(201);
    await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-edge-sale-a")
      .send({ saleId: draftA.body.id, payments: [{ method: "cash", amountMinor: draftA.body.totalMinor }] });
    const draftB = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ lines: [{ productId, qty: 2 }], branchId: branchB });
    expect(draftB.status).toBe(201);
    await request(app.getHttpServer()).post("/api/v1/sales/complete")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", "http-edge-sale-b")
      .send({ saleId: draftB.body.id, payments: [{ method: "cash", amountMinor: draftB.body.totalMinor }] });
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const to = new Date(Date.now() + 86400000).toISOString();
    const range = `dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}&compare=none`;
    const branches = await request(app.getHttpServer()).get(`/api/v1/reports/branches?${range}`)
      .set("Cookie", cookie);
    expect(branches.status).toBe(200);
    const rows = branches.body.rows as Array<{ branchId: string | null; sales: number }>;
    const rowA = rows.find((r) => r.branchId === branchA)!;
    const rowB = rows.find((r) => r.branchId === branchB)!;
    expect(rowA.sales).toBe(draftA.body.totalMinor);
    expect(rowB.sales).toBe(draftB.body.totalMinor);
    const overview = await request(app.getHttpServer()).get(`/api/v1/dashboard/overview?${range}`)
      .set("Cookie", cookie);
    expect(overview.status).toBe(200);
    expect(rows.reduce((s, r) => s + r.sales, 0)).toBe(overview.body.kpis.netRevenue.value);
  });
});

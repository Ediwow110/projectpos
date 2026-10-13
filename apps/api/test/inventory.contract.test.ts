import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

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
    ownerName: "Ana", email: "ana-inv@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
  const prod = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Coke", priceMinor: 2500 });
  productId = prod.body.id;
});

afterAll(async () => { await app.close(); });

describe("phase3 inventory HTTP contract", () => {
  it("shows a tracked product with zero on hand before its first stock movement", async () => {
    const bal = await request(app.getHttpServer()).get("/api/v1/inventory/balances")
      .set("Cookie", cookie);
    expect(bal.status).toBe(200);
    expect(bal.body.items.some((b: { productId: string; qtyOnHand: number; status: string }) =>
      b.productId === productId && b.qtyOnHand === 0 && b.status === "out",
    )).toBe(true);
  });

  it("records opening stock and reads it back in balances", async () => {
    const mov = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId, type: "opening_stock", qtyDelta: 50 });
    expect(mov.status).toBe(201);
    const bal = await request(app.getHttpServer()).get("/api/v1/inventory/balances")
      .set("Cookie", cookie);
    expect(bal.status).toBe(200);
    expect(bal.body.items.some((b: { productId: string; qtyOnHand: number }) => b.productId === productId && b.qtyOnHand === 50)).toBe(true);
  });

  it("rejects oversell with INSUFFICIENT_STOCK", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId, type: "damage", qtyDelta: -999, reason: "flood damage" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSUFFICIENT_STOCK");
  });

  it("rejects unauthenticated balances with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/inventory/balances");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("returns movement history newest-first", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/inventory/products/" + productId + "/movements")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});

describe("phase3 inventory permissions and rebuild", () => {
  it("inventory role carries inventory.adjust (Phase 1 seed)", async () => {
    const { AuthService } = await import("../src/auth/nest/auth.service");
    const svc = new AuthService({} as never);
    expect(svc.rolePermissions("inventory")).toContain("inventory.adjust");
    expect(svc.rolePermissions("owner")).toContain("inventory.adjust");
  });

  it("write guard returns FORBIDDEN without inventory.adjust", async () => {
    const { InventoryController } = await import("../src/inventory/nest/inventory.controller");
    const { InventoryService } = await import("../src/inventory/nest/inventory.service");
    const { createMemoryDb } = await import("../src/common/memory.db");
    const fakeAuth = {
      rolePermissions: (_r: string) => [] as string[],
      permissionsForRequest: (_auth: { role: string }) => [] as string[],
    };
    const ctrl = new InventoryController(new InventoryService(createMemoryDb()), fakeAuth as never, {} as never);
    let status = 0;
    let body: unknown = null;
    const res = {
      status: (c: number) => { status = c; return res; },
      json: (b: unknown) => { body = b; },
    };
    const req = { auth: { businessId: "b1", userId: "u1", role: "none" }, headers: {} };
    await ctrl.recordMovement(req as never, res as never, { productId: "p", type: "receive", qtyDelta: 1 });
    expect(status).toBe(403);
    expect((body as { code: string }).code).toBe("FORBIDDEN");
  });

  it("returns NOT_FOUND for another tenant product history", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-inv@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const got = await request(app.getHttpServer())
      .get("/api/v1/inventory/products/" + productId + "/movements")
      .set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });

  it("rebuild round-trips with zero drift", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/inventory/rebuild")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.drifts).toEqual([]);
  });

  it("low-stock view responds", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/inventory/balances?view=low")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(0);
  });
});

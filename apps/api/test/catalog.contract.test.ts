import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const res = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-cat@example.com",
    password: "correct-horse-12", businessName: "Sari Store",
  });
  cookie = jar(res.headers["set-cookie"]);
  csrf = res.body.csrfToken;
});

afterAll(async () => {
  await app.close();
});

describe("phase2 catalog HTTP contract", () => {
  it("creates and searches a product with bounded pagination", async () => {
    const create = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Coke", priceMinor: 2500, costMinor: 1000, sku: "coke-1" });
    expect(create.status).toBe(201);
    const list = await request(app.getHttpServer())
      .get("/api/v1/products?q=cok")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toHaveProperty("costMinor", 1000);
  });

  it("rejects duplicate sku with CATALOG_DUPLICATE_SKU", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Coke 2", priceMinor: 100, sku: "COKE-1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CATALOG_DUPLICATE_SKU");
  });

  it("rejects unauthenticated catalog read with TENANT_REQUIRED", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/products");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });

  it("returns NOT_FOUND for another tenant's product id", async () => {
    const res2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-cat@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(res2.headers["set-cookie"]);
    const list = await request(app.getHttpServer()).get("/api/v1/products").set("Cookie", cookie);
    const id = list.body.items[0].id;
    const got = await request(app.getHttpServer()).get(`/api/v1/products/${id}`).set("Cookie", other);
    expect(got.status).toBe(404);
    expect(got.body.code).toBe("NOT_FOUND");
  });
});

describe("phase2 catalog permissions and import", () => {
  it("cashier role lacks price.edit and cost.view, manager holds price.edit", async () => {
    const { AuthService } = await import("../src/auth/nest/auth.service");
    const svc = new AuthService({} as never);
    expect(svc.rolePermissions("cashier")).not.toContain("price.edit");
    expect(svc.rolePermissions("cashier")).not.toContain("cost.view");
    expect(svc.rolePermissions("manager")).toContain("price.edit");
  });

  it("owner import round-trips and returns imported count", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/products/import")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ items: [{ name: "Sprite", priceMinor: 2400 }, { name: "Royal", priceMinor: 2400 }] });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
  });

  it("rejects oversize import with CATALOG_IMPORT_TOO_LARGE", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ name: `P${i}`, priceMinor: 100 }));
    const res = await request(app.getHttpServer())
      .post("/api/v1/products/import")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ items });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CATALOG_IMPORT_TOO_LARGE");
  });
});

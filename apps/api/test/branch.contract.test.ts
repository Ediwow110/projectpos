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
  app = await createTestApp();
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Ana", email: "ana-branch@example.com",
    password: "correct-horse-12", businessName: "Branch Store",
  });
  cookie = jar(reg.headers["set-cookie"]);
  csrf = reg.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase9a branch HTTP contract", () => {
  it("creates branches and rejects duplicates", async () => {
    process.env["PLATFORM_API_KEY"] = "test-platform-key";
    const me = await request(app.getHttpServer()).get("/api/v1/business")
      .set("Cookie", cookie);
    // Trial Pro has no branches allowance: upgrade to Enterprise like an operator would.
    const upgraded = await request(app.getHttpServer()).patch(`/api/v1/platform/businesses/${me.body.id}/plan`)
      .set("x-platform-key", "test-platform-key")
      .send({ planKey: "enterprise" });
    expect(upgraded.status).toBe(200);
    const first = await request(app.getHttpServer()).post("/api/v1/branches")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Main" });
    expect(first.status).toBe(201);
    expect(first.body.type).toBe("store");
    const dup = await request(app.getHttpServer()).post("/api/v1/branches")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Main" });
    expect(dup.status).toBe(400);
    expect(dup.body.code).toBe("VALIDATION");
    const warehouse = await request(app.getHttpServer()).post("/api/v1/branches")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: "Warehouse", type: "warehouse" });
    expect(warehouse.status).toBe(201);
    expect(warehouse.body.type).toBe("warehouse");
  });
  it("lists branches scoped to the business", async () => {
    const list = await request(app.getHttpServer()).get("/api/v1/branches")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((b: { name: string }) => b.name)).toEqual(
      expect.arrayContaining(["Main", "Warehouse"]),
    );
    const reg2 = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Bo", email: "bo-branch@example.com",
      password: "correct-horse-12", businessName: "Other Store",
    });
    const other = jar(reg2.headers["set-cookie"]);
    const otherList = await request(app.getHttpServer()).get("/api/v1/branches")
      .set("Cookie", other);
    expect(otherList.status).toBe(200);
    expect(otherList.body.items).toEqual([]);
  });
  it("rejects unauthenticated reads", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/branches");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TENANT_REQUIRED");
  });
  it("blocks cashier branch management at the service level", async () => {
    const { createMemoryDb } = await import("../src/common/memory.db");
    const { BranchService } = await import("../src/branches/nest/branch.service");
    const svc = new BranchService(createMemoryDb());
    await expect(
      svc.createBranch("b1", "u9", "r9", { name: "Back" }, "cashier"),
    ).rejects.toThrow("FORBIDDEN");
  });
});

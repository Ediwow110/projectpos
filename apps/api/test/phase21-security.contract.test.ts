import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
const jar = (header: unknown): string => (Array.isArray(header) ? header : [String(header ?? "")]).map((value) => String(value).split(";")[0]).join("; ");

beforeAll(async () => { app = await createTestApp(); });
afterAll(async () => { await app.close(); });

describe("phase21 security boundaries", () => {
  it("keeps family dimensions tenant-scoped and permission-gated", async () => {
    const suffix = Date.now();
    const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ ownerName: "Owner", email: `phase21-owner-${suffix}@example.com`, password: "correct-horse-12", businessName: `Owner Store ${suffix}` });
    const other = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ ownerName: "Other", email: `phase21-other-${suffix}@example.com`, password: "correct-horse-12", businessName: `Other Store ${suffix}` });
    const ownerCookie = jar(owner.headers["set-cookie"]);
    const otherCookie = jar(other.headers["set-cookie"]);
    const family = await request(app.getHttpServer()).post("/api/v1/product-families")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", owner.body.csrfToken)
      .send({ name: "Protected Tee", options: [{ name: "Size", values: ["S"] }] });
    expect(family.status).toBe(201);

    const crossTenantRead = await request(app.getHttpServer()).get(`/api/v1/product-families/${family.body.id}`).set("Cookie", otherCookie);
    expect(crossTenantRead.status).toBe(404);
    expect(crossTenantRead.body.code).toBe("NOT_FOUND");
    const crossTenantWrite = await request(app.getHttpServer()).patch(`/api/v1/product-families/${family.body.id}/options`)
      .set("Cookie", otherCookie).set("X-CSRF-Token", other.body.csrfToken)
      .send({ options: [{ id: family.body.options[0].id, addValues: ["M"] }] });
    expect(crossTenantWrite.status).toBe(404);
    expect(crossTenantWrite.body.code).toBe("NOT_FOUND");
  });

  it("returns a generated correlation ID for an unsafe caller header", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/product-families").set("X-Request-Id", "a".repeat(129));
    expect(response.status).toBe(401);
    expect(response.headers["x-request-id"]).toMatch(/^req_[A-Za-z0-9_]+$/);
    expect(response.body.correlationId).toBe(response.headers["x-request-id"]);
  });
});

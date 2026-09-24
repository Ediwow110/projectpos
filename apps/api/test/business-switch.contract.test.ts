import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let jarA: string;
let csrfA: string;
let jarB: string;
let csrfB: string;
let businessAId: string;
let emailB: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const regA = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Owner A", email: "switch-a@example.com",
    password: "correct-horse-12", businessName: "Business A",
  });
  jarA = jar(regA.headers["set-cookie"]);
  csrfA = regA.body.csrfToken;
  const meA = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jarA);
  businessAId = meA.body.businessId as string;

  emailB = `switch-b-${Date.now()}@example.com`;
  const regB = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Owner B", email: emailB,
    password: "correct-horse-12", businessName: "Business B",
  });
  jarB = jar(regB.headers["set-cookie"]);
  csrfB = regB.body.csrfToken;
});

afterAll(async () => { await app.close(); });

describe("phase11 session active business (FR-TENANT-02)", () => {
  it("persists the business switch on the session and resolves it in the guard", async () => {
    // Owner A invites owner B's user into business A over HTTP.
    const invite = await request(app.getHttpServer()).post("/api/v1/memberships")
      .set("Cookie", jarA).set("X-CSRF-Token", csrfA)
      .send({ email: emailB, name: "Owner B", role: "manager" });
    expect(invite.status).toBe(201);

    const meBefore = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jarB);
    expect(meBefore.body.businessId).not.toBe(businessAId);

    const switched = await request(app.getHttpServer()).post("/api/v1/auth/active-business")
      .set("Cookie", jarB).set("X-CSRF-Token", csrfB)
      .send({ businessId: businessAId });
    expect(switched.status).toBe(201);

    const meAfter = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jarB);
    expect(meAfter.body.businessId).toBe(businessAId);
  });
});

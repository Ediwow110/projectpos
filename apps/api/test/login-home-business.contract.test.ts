import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

let app: INestApplication;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
});

afterAll(async () => { await app.close(); });

describe("login picks a workspace the caller can actually use", () => {
  it("refuses a session for a member whose only business deactivated them", async () => {
    const email = `deactivated-only-${Date.now()}@example.com`;
    const registered = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Solo Owner", email, password: "correct-horse-12", businessName: "Solo Store",
    });
    const ownerJar = jar(registered.headers["set-cookie"]);
    const memberships = await request(app.getHttpServer()).get("/api/v1/memberships").set("Cookie", ownerJar);
    const self = (memberships.body.items as Array<{ id: string; role: string }>).find((row) => row.role === "owner");
    expect(self).toBeTruthy();

    await app.get<DbPort>("DbPort").updateMembership(self!.id, registered.body.business.id, { deactivatedAt: new Date() });

    const attempted = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password: "correct-horse-12" });
    expect(attempted.status).toBe(401);
    expect(attempted.body.code).toBe("TENANT_REQUIRED");
  });

  it("starts the session in a live business when the first membership was deactivated", async () => {
    const email = `deactivated-first-${Date.now()}@example.com`;
    const home = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Two Store User", email, password: "correct-horse-12", businessName: "Dead Store",
    });
    const homeBusinessId = home.body.business.id as string;

    const hostEmail = `deactivated-host-${Date.now()}@example.com`;
    const host = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Host Owner", email: hostEmail, password: "correct-horse-12", businessName: "Live Store",
    });
    const hostJar = jar(host.headers["set-cookie"]);
    const invited = await request(app.getHttpServer()).post("/api/v1/memberships")
      .set("Cookie", hostJar).set("X-CSRF-Token", host.body.csrfToken)
      .send({ email, name: "Two Store User", role: "manager" });
    expect(invited.status).toBe(201);
    const liveBusinessId = host.body.business.id as string;

    const homeMemberships = await request(app.getHttpServer()).get("/api/v1/memberships").set("Cookie", jar(home.headers["set-cookie"]));
    const homeSelf = (homeMemberships.body.items as Array<{ id: string; userId: string }>)
      .find((row) => row.userId === home.body.user.id);
    expect(homeSelf).toBeTruthy();
    await app.get<DbPort>("DbPort").updateMembership(homeSelf!.id, homeBusinessId, { deactivatedAt: new Date() });

    const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password: "correct-horse-12" });
    expect(login.status).toBe(201);
    expect(login.body.businessId).toBe(liveBusinessId);

    const me = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jar(login.headers["set-cookie"]));
    expect(me.status).toBe(200);
    expect(me.body.businessId).toBe(liveBusinessId);
  });
});

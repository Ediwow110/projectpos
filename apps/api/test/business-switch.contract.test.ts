import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

let app: INestApplication;
let jarA: string;
let csrfA: string;
let jarB: string;
let csrfB: string;
let businessAId: string;
let businessBId: string;
let emailB: string;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
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
  const meB = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jarB);
  businessBId = meB.body.businessId as string;
});

afterAll(async () => { await app.close(); });

describe("phase11 session active business (FR-TENANT-02)", () => {
  it("starts a new authenticated session in All branches scope", async () => {
    const email = `switch-fresh-${Date.now()}@example.com`;
    const registered = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Fresh Owner",
      email,
      password: "correct-horse-12",
      businessName: "Fresh Business",
    });
    expect(registered.status).toBe(201);

    const freshJar = jar(registered.headers["set-cookie"]);
    const profile = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", freshJar);
    expect(profile.status).toBe(200);
    expect(profile.body.activeBranchId).toBeNull();
    expect(profile.body.activeBranchName).toBeNull();
  });

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

  it("persists an active branch, rejects cross-business branches, and clears branch scope on business switch", async () => {
    const db = app.get<DbPort>("DbPort");
    const branchA = await db.createBranch({ businessId: businessAId, name: "North Store", type: "store", isActive: true });
    const branchB = await db.createBranch({ businessId: businessBId, name: "South Store", type: "store", isActive: true });

    const resetBusiness = await request(app.getHttpServer()).post("/api/v1/auth/active-business")
      .set("Cookie", jarB).set("X-CSRF-Token", csrfB)
      .send({ businessId: businessBId });
    expect(resetBusiness.status).toBe(201);

    const crossTenant = await request(app.getHttpServer()).post("/api/v1/me/active-branch")
      .set("Cookie", jarB).set("X-CSRF-Token", csrfB)
      .send({ branchId: branchA.id });
    expect(crossTenant.status).toBe(404);

    const selected = await request(app.getHttpServer()).post("/api/v1/me/active-branch")
      .set("Cookie", jarB).set("X-CSRF-Token", csrfB)
      .send({ branchId: branchB.id });
    expect(selected.status).toBe(200);
    expect(selected.body).toMatchObject({ activeBranchId: branchB.id, activeBranchName: "South Store" });

    const meSelected = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jarB);
    expect(meSelected.body.activeBranchId).toBe(branchB.id);
    expect(meSelected.body.activeBranchName).toBe("South Store");

    const switched = await request(app.getHttpServer()).post("/api/v1/auth/active-business")
      .set("Cookie", jarB).set("X-CSRF-Token", csrfB)
      .send({ businessId: businessAId });
    expect(switched.status).toBe(201);

    const meAfterBusinessSwitch = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jarB);
    expect(meAfterBusinessSwitch.body.businessId).toBe(businessAId);
    expect(meAfterBusinessSwitch.body.activeBranchId).toBeNull();
    expect(meAfterBusinessSwitch.body.activeBranchName).toBeNull();

    expect(businessBId).not.toBe(businessAId);
  });

  it("rejects inactive branches and clears an archived active branch on the next authenticated request", async () => {
    const db = app.get<DbPort>("DbPort");
    const resetBusiness = await request(app.getHttpServer()).post("/api/v1/auth/active-business")
      .set("Cookie", jarB).set("X-CSRF-Token", csrfB)
      .send({ businessId: businessBId });
    expect(resetBusiness.status).toBe(201);

    const inactive = await db.createBranch({
      businessId: businessBId,
      name: `Inactive ${Date.now()}`,
      type: "store",
      isActive: false,
    });
    const rejected = await request(app.getHttpServer()).post("/api/v1/me/active-branch")
      .set("Cookie", jarB).set("X-CSRF-Token", csrfB)
      .send({ branchId: inactive.id });
    expect(rejected.status).toBe(400);

    const active = await db.createBranch({
      businessId: businessBId,
      name: `Temporary ${Date.now()}`,
      type: "store",
      isActive: true,
    });
    const selected = await request(app.getHttpServer()).post("/api/v1/me/active-branch")
      .set("Cookie", jarB).set("X-CSRF-Token", csrfB)
      .send({ branchId: active.id });
    expect(selected.status).toBe(200);
    expect(selected.body.activeBranchId).toBe(active.id);

    await db.updateBranch(active.id, businessBId, { isActive: false });

    const afterArchive = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jarB);
    expect(afterArchive.status).toBe(200);
    expect(afterArchive.body.activeBranchId).toBeNull();
    expect(afterArchive.body.activeBranchName).toBeNull();

    const persistedClear = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", jarB);
    expect(persistedClear.body.activeBranchId).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

function cookies(headers: unknown): string {
  const array = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return array.map((item) => String(item).split(";")[0]).join("; ");
}

interface StaffSession {
  role: "manager" | "cashier" | "inventory";
  email: string;
  membershipId: string;
  cookie: string;
  csrf: string;
}

const READINESS_KEYS = [
  "businessConfigured",
  "canCustomizeReceipt",
  "hasActiveRegister",
  "hasOpenShift",
  "hasSellableProduct",
  "hasStaff",
  "legacySetupReviewSteps",
  "missing",
  "readyForFirstSale",
];

describe("owner-surface authorization", () => {
  let app: INestApplication;
  let ownerCookie = "";
  let ownerCsrf = "";
  let businessId = "";
  const staff: StaffSession[] = [];

  beforeAll(async () => {
    app = await createTestApp({ completedOnboardingFixture: true });
    const server = app.getHttpServer();
    const owner = await request(server).post("/api/v1/auth/register").send({
      ownerName: "Surface Owner",
      email: "surface-owner@example.com",
      password: "correct-horse-12",
      businessName: "Surface Test Store",
    });
    expect(owner.status).toBe(201);
    businessId = owner.body.business.id as string;
    ownerCookie = cookies(owner.headers["set-cookie"]);
    ownerCsrf = owner.body.csrfToken as string;

    for (const role of ["manager", "cashier", "inventory"] as const) {
      const email = `surface-${role}@example.com`;
      const invited = await request(server)
        .post("/api/v1/memberships")
        .set("Cookie", ownerCookie)
        .set("X-CSRF-Token", ownerCsrf)
        .send({ name: `${role} staff`, email, role });
      expect(invited.status, role).toBe(201);
      const login = await request(server)
        .post("/api/v1/auth/login")
        .send({ email, password: invited.body.tempPassword });
      expect(login.status, role).toBe(201);
      staff.push({
        role,
        email,
        membershipId: invited.body.membershipId as string,
        cookie: cookies(login.headers["set-cookie"]),
        csrf: login.body.csrfToken as string,
      });
    }

    // Persist real member-scope policy before the projection assertions so a
    // regression that stops redacting it cannot pass an empty-settings check.
    const reauth = await request(server)
      .post("/api/v1/auth/confirm-password")
      .set("Cookie", ownerCookie)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ password: "correct-horse-12" });
    expect(reauth.status).toBe(201);
    const manager = staff.find((member) => member.role === "manager")!;
    const restricted = await request(server)
      .patch(`/api/v1/memberships/${manager.membershipId}/restrictions`)
      .set("Cookie", ownerCookie)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ deniedPermissions: ["cost.view"] });
    expect(restricted.status).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("rejects signed-out direct reads of owner and setup surfaces", async () => {
    const server = app.getHttpServer();
    for (const path of [
      "/api/v1/business",
      "/api/v1/onboarding",
      "/api/v1/onboarding/readiness",
      "/api/v1/memberships",
      "/api/v1/memberships/role-permissions",
      "/api/v1/owner/audit",
      "/api/v1/admin/support/cases",
      "/api/v1/admin/support/consents",
    ]) {
      const response = await request(server).get(path);
      expect(response.status, path).toBe(401);
    }
  });

  it("denies every non-owner role the owner management surfaces", async () => {
    const server = app.getHttpServer();
    for (const session of staff) {
      for (const path of [
        "/api/v1/memberships",
        "/api/v1/memberships/role-permissions",
        "/api/v1/owner/audit",
        "/api/v1/admin/support/cases",
        "/api/v1/admin/support/consents",
      ]) {
        const response = await request(server).get(path).set("Cookie", session.cookie);
        expect(response.status, `${session.role} ${path}`).toBe(403);
        expect(response.body.code, `${session.role} ${path}`).toBe("FORBIDDEN");
      }
    }
  });

  it("projects business settings without member-scope maps for non-owners", async () => {
    const server = app.getHttpServer();
    for (const session of staff) {
      const response = await request(server).get("/api/v1/business").set("Cookie", session.cookie);
      expect(response.status, session.role).toBe(200);
      const raw = JSON.stringify(response.body);
      for (const key of [
        "memberPermissionDenials",
        "memberBranchAssignments",
        "memberRegisterAssignments",
      ]) {
        expect(raw, `${session.role} must not receive ${key}`).not.toContain(key);
      }
      // Operational settings that staff need (receipt text, tax defaults and
      // the public storefront key) stay readable; they are not authorization
      // scope and carry no credentials.
      expect(response.body.settings.businessAddress).toBe("123 Fixture Street, Manila");
      expect(response.body.settings.taxName).toBe("No tax");
    }
  });

  it("limits onboarding reads to progress and readiness metadata", async () => {
    const server = app.getHttpServer();
    for (const session of staff) {
      const progress = await request(server).get("/api/v1/onboarding").set("Cookie", session.cookie);
      expect(progress.status, session.role).toBe(200);
      expect(Object.keys(progress.body as Record<string, unknown>).sort()).toEqual(["currentStep", "steps"]);
      const progressRaw = JSON.stringify(progress.body);
      for (const field of ["businessAddress", "taxRateBps", "receiptHeader", "standardReceiptConfirmed"]) {
        expect(progressRaw, `${session.role} onboarding must not leak ${field}`).not.toContain(field);
      }

      const readiness = await request(server)
        .get("/api/v1/onboarding/readiness")
        .set("Cookie", session.cookie);
      expect(readiness.status, session.role).toBe(200);
      expect(Object.keys(readiness.body as Record<string, unknown>).sort()).toEqual(READINESS_KEYS);
      expect(Array.isArray(readiness.body.missing)).toBe(true);
      expect((readiness.body.missing as unknown[]).every((key) => typeof key === "string")).toBe(true);
      expect(JSON.stringify(readiness.body), `${session.role} readiness must not leak staff identity`)
        .not.toContain("@example.com");
    }
  });

  it("rejects non-owner writes to settings and onboarding", async () => {
    const server = app.getHttpServer();
    for (const session of staff) {
      const settings = await request(server)
        .patch("/api/v1/business/settings")
        .set("Cookie", session.cookie)
        .set("X-CSRF-Token", session.csrf)
        .send({ taxName: "Injected", taxRateBps: 1200 });
      expect(settings.status, `${session.role} settings`).toBe(403);
      expect(settings.body.code).toBe("FORBIDDEN");

      const onboarding = await request(server)
        .patch("/api/v1/onboarding")
        .set("Cookie", session.cookie)
        .set("X-CSRF-Token", session.csrf)
        .send({ step: "products", state: "skipped" });
      expect(onboarding.status, `${session.role} onboarding`).toBe(403);
      expect(onboarding.body.code).toBe("FORBIDDEN");
    }

    const ownerView = await request(server).get("/api/v1/business").set("Cookie", ownerCookie);
    const manager = staff.find((member) => member.role === "manager")!;
    expect(ownerView.body.settings.memberPermissionDenials[manager.membershipId]).toEqual(["cost.view"]);
    const unchanged = await request(server).get("/api/v1/business").set("Cookie", ownerCookie);
    expect(unchanged.body.settings.taxName).toBe("No tax");
    expect(unchanged.body.settings.taxRateBps).toBe(0);
  });

  it("fails closed for a deactivated membership on its existing session", async () => {
    const server = app.getHttpServer();
    const email = "surface-deactivated@example.com";
    const invited = await request(server)
      .post("/api/v1/memberships")
      .set("Cookie", ownerCookie)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ name: "Deactivated staff", email, role: "cashier" });
    expect(invited.status).toBe(201);
    const login = await request(server)
      .post("/api/v1/auth/login")
      .send({ email, password: invited.body.tempPassword });
    expect(login.status).toBe(201);
    const sessionCookie = cookies(login.headers["set-cookie"]);

    const deactivated = await request(server)
      .post(`/api/v1/memberships/${invited.body.membershipId as string}/deactivate`)
      .set("Cookie", ownerCookie)
      .set("X-CSRF-Token", ownerCsrf);
    expect(deactivated.status).toBe(200);

    const denied = await request(server).get("/api/v1/business").set("Cookie", sessionCookie);
    expect([401, 403]).toContain(denied.status);
    expect(denied.body.settings).toBeUndefined();
  });

  it("keeps owner audit and business reads tenant-scoped", async () => {
    const server = app.getHttpServer();
    const other = await request(server).post("/api/v1/auth/register").send({
      ownerName: "Other Owner",
      email: "surface-other@example.com",
      password: "correct-horse-12",
      businessName: "Other Surface Store",
    });
    expect(other.status).toBe(201);

    const audit = await request(server)
      .get("/api/v1/owner/audit?limit=50")
      .set("Cookie", cookies(other.headers["set-cookie"]));
    expect(audit.status).toBe(200);
    expect(
      (audit.body.items as Array<{ entityId: string }>).every((item) => item.entityId !== businessId),
    ).toBe(true);

    const business = await request(server)
      .get("/api/v1/business")
      .set("Cookie", cookies(other.headers["set-cookie"]));
    expect(business.body.id).not.toBe(businessId);
    expect(business.body.name).toBe("Other Surface Store");
  });
});

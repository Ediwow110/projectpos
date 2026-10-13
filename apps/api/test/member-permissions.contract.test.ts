import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

function cookies(headers: unknown): string {
  const array = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return array.map((item) => String(item).split(";")[0]).join("; ");
}

describe("owner-managed permission restrictions HTTP contract", () => {
  let app: INestApplication;
  let businessId: string;
  let ownerCookie: string;
  let ownerCsrf: string;
  let staffCookie: string;
  let staffCsrf: string;
  let staffMembershipId: string;

  beforeAll(async () => {
    app = await createTestApp({ completedOnboardingFixture: true });
    const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Owner", email: "permission-owner@example.com",
      password: "correct-horse-12", businessName: "Permission Test Store",
    });
    expect(owner.status).toBe(201);
    businessId = owner.body.business.id as string;
    ownerCookie = cookies(owner.headers["set-cookie"]);
    ownerCsrf = owner.body.csrfToken as string;
    const invited = await request(app.getHttpServer()).post("/api/v1/memberships")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf).send({
        name: "Inventory Staff", email: "permission-inventory@example.com", role: "inventory",
      });
    expect(invited.status).toBe(201);
    staffMembershipId = invited.body.membershipId as string;
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({
      email: "permission-inventory@example.com", password: invited.body.tempPassword,
    });
    expect(login.status).toBe(201);
    staffCookie = cookies(login.headers["set-cookie"]);
    staffCsrf = login.body.csrfToken as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("requires fresh owner authentication, never accepts a grant outside the role, and protects owners", async () => {
    const wrong = await request(app.getHttpServer())
      .patch(`/api/v1/memberships/${staffMembershipId}/restrictions`)
      .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf)
      .send({ deniedPermissions: ["price.edit"] });
    expect(wrong.status).toBe(403);

    const reauth = await request(app.getHttpServer()).post("/api/v1/auth/confirm-password")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ password: "correct-horse-12" });
    expect(reauth.status).toBe(201);

    const unknown = await request(app.getHttpServer())
      .patch(`/api/v1/memberships/${staffMembershipId}/restrictions`)
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ deniedPermissions: ["made-up.permission"] });
    expect(unknown.status).toBe(400);
  });

  it("denies a previously allowed product action on the employee's existing session", async () => {
    const server = app.getHttpServer();
    const before = await request(server).post("/api/v1/products")
      .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf)
      .send({ name: "Before policy change", priceMinor: 400 });
    expect(before.status).toBe(201);

    const saved = await request(server)
      .patch(`/api/v1/memberships/${staffMembershipId}/restrictions`)
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ deniedPermissions: ["price.edit", "cost.view"] });
    expect(saved.status).toBe(200);
    expect(saved.body.deniedPermissions).toEqual(["price.edit", "cost.view"]);

    const after = await request(server).post("/api/v1/products")
      .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf)
      .send({ name: "After policy change", priceMinor: 400 });
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("FORBIDDEN");

    const staffBusiness = await request(server).get("/api/v1/business").set("Cookie", staffCookie);
    expect(staffBusiness.status).toBe(200);
    expect(staffBusiness.body.settings.memberPermissionDenials).toBeUndefined();
    const ownerBusiness = await request(server).get("/api/v1/business").set("Cookie", ownerCookie);
    expect(ownerBusiness.status).toBe(200);
    expect(ownerBusiness.body.settings.memberPermissionDenials[staffMembershipId]).toEqual(["price.edit", "cost.view"]);
    expect(ownerBusiness.body.id).toBe(businessId);
  });

  it("exposes sanitized, tenant-scoped audit to owners only", async () => {
    const server = app.getHttpServer();
    const denied = await request(server).get("/api/v1/owner/audit").set("Cookie", staffCookie);
    expect(denied.status).toBe(403);
    const audit = await request(server).get("/api/v1/owner/audit?limit=20&action=member.permissions")
      .set("Cookie", ownerCookie);
    expect(audit.status).toBe(200);
    expect(audit.body.items.some((event: { action: string }) => event.action === "member.permissions.restricted")).toBe(true);
    expect(audit.body.items.every((event: { before?: unknown; after?: unknown }) =>
      event.before === undefined && event.after === undefined)).toBe(true);
    const invalid = await request(server).get("/api/v1/owner/audit?limit=1000").set("Cookie", ownerCookie);
    expect(invalid.status).toBe(400);
  });

  it("requires owner reauthentication and validates the financial threshold", async () => {
    const server = app.getHttpServer();
    const cashier = await request(server).patch("/api/v1/business/settings")
      .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf)
      .send({ refundApprovalThresholdMinor: 1000 });
    expect(cashier.status).toBe(403);
    const bad = await request(server).patch("/api/v1/business/settings")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ refundApprovalThresholdMinor: -1 });
    expect(bad.status).toBe(400);
    const good = await request(server).patch("/api/v1/business/settings")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({
        refundApprovalThresholdMinor: 250000,
        orderDiscountApprovalPercent: 8,
        lineDiscountApprovalPercent: 15,
      });
    expect(good.status).toBe(200);
    const business = await request(server).get("/api/v1/business").set("Cookie", ownerCookie);
    expect(business.body.settings.refundApprovalThresholdMinor).toBe(250000);
    expect(business.body.settings.orderDiscountApprovalPercent).toBe(8);
    expect(business.body.settings.lineDiscountApprovalPercent).toBe(15);
  });

  it("enforces assigned branches on existing sessions and fails closed for cross-branch requests", async () => {
    const server = app.getHttpServer();
    const db = app.get<DbPort>("DbPort");
    const first = await db.createBranch({ businessId, name: "Local Main", type: "store", isActive: true });
    const second = await db.createBranch({ businessId, name: "Remote Outlet", type: "store", isActive: true });
    const register = await db.createRegister({
      businessId, name: "Main counter", isActive: true, branchId: first.id,
    });
    const otherRegister = await db.createRegister({
      businessId, name: "Remote counter", isActive: true, branchId: second.id,
    });
    const secondLocalRegister = await db.createRegister({
      businessId, name: "Additional local counter", isActive: true, branchId: first.id,
    });
    for (const [branchId, index] of [[first.id, 1], [second.id, 2]] as const) {
      await db.createSale({
        businessId, receiptNo: "2026-0000" + index, status: "DRAFT",
        subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0,
        paidMinor: 0, changeMinor: 0, currency: "PHP",
        customerId: null, customerName: null, notes: null,
        actorId: "cashier", requestId: "scope-list", idempotencyKey: null,
        registerId: index === 1 ? register.id : otherRegister.id,
        branchId, createdAt: new Date(),
      });
    }
    const reauth = await request(server).post("/api/v1/auth/confirm-password")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ password: "correct-horse-12" });
    expect(reauth.status).toBe(201);
    const assigned = await request(server).patch(`/api/v1/memberships/${staffMembershipId}/branches`)
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ branchIds: [first.id] });
    expect(assigned.status).toBe(200);
    expect(assigned.body.branchIds).toEqual([first.id]);

    const staffMe = await request(server).get("/api/v1/me").set("Cookie", staffCookie);
    expect(staffMe.status).toBe(200);
    expect(staffMe.body.activeBranchId).toBe(first.id);
    const list = await request(server).get("/api/v1/branches").set("Cookie", staffCookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([first.id]);
    const registers = await request(server).get("/api/v1/registers").set("Cookie", staffCookie);
    expect(registers.status).toBe(200);
    expect(registers.body.items.map((item: { id: string }) => item.id).sort())
      .toEqual([register.id, secondLocalRegister.id].sort());
    const sales = await request(server).get("/api/v1/sales").set("Cookie", staffCookie);
    expect(sales.status).toBe(200);
    expect(sales.body.items).toHaveLength(1);
    expect(sales.body.items[0].branchId).toBe(first.id);
    const shifts = await request(server).get("/api/v1/shifts").set("Cookie", staffCookie);
    expect(shifts.status).toBe(200);

    const restrictedRegisters = await request(server)
      .patch(`/api/v1/memberships/${staffMembershipId}/registers`)
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ registerIds: [register.id] });
    expect(restrictedRegisters.status).toBe(200);
    const scopedRegisters = await request(server).get("/api/v1/registers").set("Cookie", staffCookie);
    expect(scopedRegisters.body.items.map((item: { id: string }) => item.id)).toEqual([register.id]);
    const localOther = await db.createSale({
      businessId, receiptNo: "2026-000099", status: "DRAFT",
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0,
      paidMinor: 0, changeMinor: 0, currency: "PHP",
      customerId: null, customerName: null, notes: null,
      actorId: "cashier", requestId: "register-restriction", idempotencyKey: null,
      registerId: secondLocalRegister.id, branchId: first.id, createdAt: new Date(),
    });
    const restrictedSales = await request(server).get("/api/v1/sales").set("Cookie", staffCookie);
    expect(restrictedSales.status).toBe(200);
    expect(restrictedSales.body.items).toHaveLength(1);
    expect(restrictedSales.body.items[0].registerId).toBe(register.id);
    const forbiddenDetail = await request(server)
      .get(`/api/v1/sales/${localOther.id}`).set("Cookie", staffCookie);
    expect(forbiddenDetail.status).toBe(403);
    const forbiddenDraft = await request(server).post("/api/v1/sales/drafts")
      .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf)
      .send({ registerId: secondLocalRegister.id, lines: [] });
    expect(forbiddenDraft.status).toBe(403);
    const blockedReport = await request(server).get("/api/v1/reports/sales").set("Cookie", staffCookie);
    expect(blockedReport.status).toBe(403);
    const noRegisterLimit = await request(server)
      .patch(`/api/v1/memberships/${staffMembershipId}/registers`)
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ registerIds: null });
    expect(noRegisterLimit.status).toBe(200);

    for (const path of [
      "/api/v1/reports/payments",
      `/api/v1/inventory/balances?branchId=${second.id}`,
      `/api/v1/reports/sales?branchId=${second.id}`,
    ]) {
      const blocked = await request(server).get(path).set("Cookie", staffCookie);
      expect(blocked.status).toBe(403);
    }
    for (const path of ["/api/v1/reports/sales", "/api/v1/reports/cash", "/api/v1/reports/inventory"]) {
      const allowedReport = await request(server).get(path).set("Cookie", staffCookie);
      expect(allowedReport.status).not.toBe(403);
      expect(allowedReport.status).toBeLessThan(500);
    }
    const crossRefund = await request(server).post(`/api/v1/sales/${(await db.listSalesByBusiness(businessId)).find((s) => s.branchId === second.id)!.id}/refund-reject`)
      .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf).send({});
    expect(crossRefund.status).toBe(403);
    const crossBranchSale = await request(server).post("/api/v1/sales/drafts")
      .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf)
      .send({ registerId: otherRegister.id, branchId: second.id, lines: [] });
    expect(crossBranchSale.status).toBe(403);
    const validBranchDraft = await request(server).post("/api/v1/sales/drafts")
      .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf)
      .send({ registerId: register.id, lines: [] });
    expect(validBranchDraft.status).not.toBe(403);
    for (const branchId of [second.id, null]) {
      const invalidSwitch = await request(server).post("/api/v1/me/active-branch")
        .set("Cookie", staffCookie).set("X-CSRF-Token", staffCsrf)
        .send({ branchId });
      expect(invalidSwitch.status).toBe(403);
    }
    const settings = await request(server).get("/api/v1/business").set("Cookie", staffCookie);
    expect(settings.status).toBe(200);
    expect(settings.body.settings.memberBranchAssignments).toBeUndefined();
    const restored = await request(server).patch(`/api/v1/memberships/${staffMembershipId}/branches`)
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ branchIds: null });
    expect(restored.status).toBe(200);
    const unrestricted = await request(server).get("/api/v1/branches").set("Cookie", staffCookie);
    expect(unrestricted.body.items).toHaveLength(2);
  });
});

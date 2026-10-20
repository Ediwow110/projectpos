import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { verifyApprovalPin } from "../../auth/approval-pin";
import { MembershipService } from "./membership.service";

const OWNER = ["user.manage", "settings.write", "sale.refund"];

describe("phase11 membership management", () => {
  it("requires assigned branches and rejects foreign or excluded registers", async () => {
    const db = createMemoryDb();
    const owner = await db.createUser({ name: "Owner", email: "reg-owner@test.invalid", passwordHash: "unused" });
    const staff = await db.createUser({ name: "Staff", email: "reg-staff@test.invalid", passwordHash: "unused" });
    const business = await db.createBusiness({ name: "Reg scope", currency: "PHP" });
    const foreign = await db.createBusiness({ name: "Foreign", currency: "PHP" });
    const ownerSeat = await db.createMembership({ businessId: business.id, userId: owner.id, role: "owner" });
    const seat = await db.createMembership({ businessId: business.id, userId: staff.id, role: "cashier" });
    const branch = await db.createBranch({ businessId: business.id, name: "Local", type: "store", isActive: true });
    const remoteBranch = await db.createBranch({ businessId: foreign.id, name: "Foreign", type: "store", isActive: true });
    const register = await db.createRegister({ businessId: business.id, branchId: branch.id, name: "Local till", isActive: true });
    const remoteRegister = await db.createRegister({ businessId: foreign.id, branchId: remoteBranch.id, name: "Other till", isActive: true });
    const svc = new MembershipService(db);
    const save = (ids: string[] | null) =>
      svc.setRegisterAssignment(business.id, owner.id, "reg-update", OWNER, seat.id, ids);
    expect(await svc.getRegisterAssignment(business.id, seat.id)).toEqual({ registerIds: null });
    await expect(save([register.id])).rejects.toThrow("VALIDATION");
    await svc.setBranchAssignment(business.id, owner.id, "branch", OWNER, seat.id, [branch.id]);
    await expect(save([remoteRegister.id])).rejects.toThrow("VALIDATION");
    await expect(save([register.id, register.id])).rejects.toThrow("VALIDATION");
    await expect(svc.setRegisterAssignment(business.id, owner.id, "owner-protect", OWNER, ownerSeat.id, [register.id]))
      .rejects.toThrow("FORBIDDEN");
    expect(await save([register.id])).toEqual({ registerIds: [register.id] });
    expect((await db.listAudit()).some((entry) =>
      entry.action === "member.registers.changed" && entry.entityId === seat.id,
    )).toBe(true);
    expect(await svc.getRegisterAssignment(business.id, seat.id)).toEqual({ registerIds: [register.id] });
    await svc.setBranchAssignment(business.id, owner.id, "restore", OWNER, seat.id, null);
    expect(await svc.getRegisterAssignment(business.id, seat.id)).toEqual({ registerIds: null });
  });
  it("stores and revokes owner-scoped branch assignments without permitting foreign or protected members", async () => {
    const db = createMemoryDb();
    const owner = await db.createUser({ name: "Owner", email: "branch-owner@test.invalid", passwordHash: "unused" });
    const staff = await db.createUser({ name: "Staff", email: "branch-staff@test.invalid", passwordHash: "unused" });
    const biz = await db.createBusiness({ name: "Scoped workplace", currency: "PHP" });
    const foreign = await db.createBusiness({ name: "Foreign workplace", currency: "PHP" });
    const ownerSeat = await db.createMembership({ businessId: biz.id, userId: owner.id, role: "owner" });
    const staffSeat = await db.createMembership({ businessId: biz.id, userId: staff.id, role: "cashier" });
    const first = await db.createBranch({ businessId: biz.id, name: "Main", type: "store", isActive: true });
    const other = await db.createBranch({ businessId: foreign.id, name: "Foreign", type: "store", isActive: true });
    const svc = new MembershipService(db);
    expect(await svc.getBranchAssignment(biz.id, staffSeat.id)).toEqual({ branchIds: null });
    await expect(svc.setBranchAssignment(biz.id, owner.id, "bad-1", OWNER, staffSeat.id, [other.id]))
      .rejects.toThrow("VALIDATION");
    await expect(svc.setBranchAssignment(biz.id, owner.id, "bad-2", OWNER, ownerSeat.id, [first.id]))
      .rejects.toThrow("FORBIDDEN");
    await expect(svc.setBranchAssignment(biz.id, staff.id, "bad-3", OWNER, staffSeat.id, [first.id]))
      .rejects.toThrow("FORBIDDEN");
    await expect(svc.setBranchAssignment(biz.id, owner.id, "bad-4", OWNER, staffSeat.id, [first.id, first.id]))
      .rejects.toThrow("VALIDATION");
    expect(await svc.setBranchAssignment(biz.id, owner.id, "set-1", OWNER, staffSeat.id, [first.id]))
      .toEqual({ branchIds: [first.id] });
    expect(await svc.getBranchAssignment(biz.id, staffSeat.id)).toEqual({ branchIds: [first.id] });
    expect((await db.listAudit()).some((event) => event.action === "member.branches.changed" && event.entityId === staffSeat.id))
      .toBe(true);
    expect(await svc.setBranchAssignment(biz.id, owner.id, "set-2", OWNER, staffSeat.id, null))
      .toEqual({ branchIds: null });
    expect(await svc.getBranchAssignment(biz.id, staffSeat.id)).toEqual({ branchIds: null });
  });
  it("returns only tenant-owned audit metadata, without sensitive before/after snapshots", async () => {
    const db = createMemoryDb();
    const one = await db.createBusiness({ name: "Audit One", currency: "PHP" });
    const two = await db.createBusiness({ name: "Audit Two", currency: "PHP" });
    const svc = new MembershipService(db);
    await db.appendAudit({
      businessId: one.id, actorId: "owner1", requestId: "r1",
      entityType: "BusinessMembership", entityId: "m1", action: "member.permissions.restricted",
      before: { password: "private" }, after: { secret: "private" },
    });
    await db.appendAudit({
      businessId: two.id, actorId: "owner2", requestId: "r2",
      entityType: "BusinessMembership", entityId: "m2", action: "member.permissions.restricted",
    });
    const result = await svc.listOwnerAudit(one.id, 50, "permissions");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ actorId: "owner1", action: "member.permissions.restricted" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("owner2");
  });
  it("persists deny-only employee restrictions by business and audits every change", async () => {
    const db = createMemoryDb();
    const owner = await db.createUser({ name: "Owner", email: "restrictions-owner@x.test", passwordHash: "unused" });
    const staff = await db.createUser({ name: "Stock clerk", email: "restrictions-staff@x.test", passwordHash: "unused" });
    const biz = await db.createBusiness({ name: "Restricted business", currency: "PHP" });
    const outside = await db.createBusiness({ name: "Outside business", currency: "PHP" });
    const ownerMembership = await db.createMembership({ businessId: biz.id, userId: owner.id, role: "owner" });
    const member = await db.createMembership({ businessId: biz.id, userId: staff.id, role: "inventory" });
    const svc = new MembershipService(db);
    expect((await svc.getPermissionRestrictions(biz.id, member.id)).deniedPermissions).toEqual([]);
    const out = await svc.setPermissionRestrictions(biz.id, owner.id, "deny-1", OWNER, member.id, ["price.edit", "cost.view"]);
    expect(out).toEqual({ role: "inventory", deniedPermissions: ["price.edit", "cost.view"] });
    expect((await svc.getPermissionRestrictions(biz.id, member.id)).deniedPermissions).toEqual(["price.edit", "cost.view"]);
    expect((await db.getSettings(biz.id))["memberPermissionDenials"]).toMatchObject({ [member.id]: ["price.edit", "cost.view"] });
    expect((await db.listAudit()).some((e) => e.action === "member.permissions.restricted" && e.entityId === member.id)).toBe(true);
    await expect(svc.setPermissionRestrictions(biz.id, owner.id, "deny-2", OWNER, member.id, ["unknown.permission"]))
      .rejects.toThrow("VALIDATION");
    await expect(svc.setPermissionRestrictions(biz.id, owner.id, "deny-3", OWNER, member.id, ["cost.view", "cost.view"]))
      .rejects.toThrow("VALIDATION");
    await expect(svc.setPermissionRestrictions(biz.id, owner.id, "deny-4", ["sale.refund"], member.id, ["price.edit"]))
      .rejects.toThrow("FORBIDDEN");
    await expect(svc.setPermissionRestrictions(biz.id, owner.id, "deny-5", OWNER, ownerMembership.id, ["price.edit"]))
      .rejects.toThrow("FORBIDDEN");
    await expect(svc.setPermissionRestrictions(biz.id, staff.id, "deny-6", OWNER, member.id, ["price.edit"]))
      .rejects.toThrow("FORBIDDEN");
    await expect(svc.setPermissionRestrictions(outside.id, owner.id, "deny-7", OWNER, member.id, ["price.edit"]))
      .rejects.toThrow("NOT_FOUND");
    await db.updateMembership(member.id, biz.id, { deactivatedAt: new Date() });
    await expect(svc.getPermissionRestrictions(biz.id, member.id)).rejects.toThrow("NOT_FOUND");
  });
  it("lets a manager's owner change an active non-owner role, with an audit and PIN reset", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "RBAC Store", currency: "PHP" });
    const owner = await db.createUser({ name: "Owner", email: "owner-role@x.test", passwordHash: "unused" });
    const staff = await db.createUser({ name: "Manager", email: "staff-role@x.test", passwordHash: "unused" });
    const ownerMem = await db.createMembership({ businessId: biz.id, userId: owner.id, role: "owner" });
    const manager = await db.createMembership({ businessId: biz.id, userId: staff.id, role: "manager" });
    const svc = new MembershipService(db);
    await svc.setApprovalPin(biz.id, owner.id, "pin-1", OWNER, manager.id, "482615");
    expect((await db.findMembership(staff.id, biz.id))?.approvalPinHash).toBeTruthy();

    expect(await svc.changeRole(biz.id, owner.id, "role-1", OWNER, manager.id, "cashier"))
      .toEqual({ ok: true, role: "cashier" });
    expect((await db.findMembership(staff.id, biz.id))?.role).toBe("cashier");
    expect((await db.findMembership(staff.id, biz.id))?.approvalPinHash).toBeNull();
    expect((await db.listAudit()).some((entry) =>
      entry.action === "member.role.changed" &&
      entry.entityId === manager.id &&
      (entry.before as { role?: string })?.role === "manager" &&
      (entry.after as { role?: string })?.role === "cashier",
    )).toBe(true);

    await expect(svc.changeRole(biz.id, owner.id, "role-2", OWNER, ownerMem.id, "cashier"))
      .rejects.toThrow("FORBIDDEN");
    await expect(svc.changeRole(biz.id, owner.id, "role-3", ["sale.refund"], manager.id, "manager"))
      .rejects.toThrow("FORBIDDEN");
    await expect(svc.changeRole(biz.id, owner.id, "role-4", OWNER, manager.id, "owner"))
      .rejects.toThrow("VALIDATION");
    await expect(svc.changeRole(biz.id, owner.id, "role-5", OWNER, manager.id, "superadmin"))
      .rejects.toThrow("VALIDATION");
    await expect(svc.changeRole(biz.id, staff.id, "role-6", OWNER, manager.id, "manager"))
      .rejects.toThrow("FORBIDDEN");
    const other = await db.createBusiness({ name: "Other", currency: "PHP" });
    await expect(svc.changeRole(other.id, owner.id, "role-7", OWNER, manager.id, "manager"))
      .rejects.toThrow("NOT_FOUND");
    await db.updateMembership(manager.id, biz.id, { deactivatedAt: new Date() });
    await expect(svc.changeRole(biz.id, owner.id, "role-8", OWNER, manager.id, "manager"))
      .rejects.toThrow("NOT_FOUND");
  });
  it("invites a new member with a one-time temp password and enforces user.manage", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const svc = new MembershipService(db);
    const out = await svc.create(biz.id, "u1", "r1", OWNER, {
      email: `c${Date.now()}@x.test`, name: "Cash Ier", role: "cashier",
    });
    expect(out.tempPassword).toHaveLength(16);
    const members = await svc.list(biz.id);
    expect(members.items).toHaveLength(1);
    expect(members.items[0]!.role).toBe("cashier");
    await expect(
      svc.create(biz.id, "u1", "r2", ["sale.refund"], {
        email: `d${Date.now()}@x.test`, name: "X", role: "cashier",
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("rejects a second owner and counts only active members against the cap", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const svc = new MembershipService(db);
    await expect(
      svc.create(biz.id, "u1", "r1", OWNER, { email: `o${Date.now()}@x.test`, name: "O", role: "owner" }),
    ).rejects.toThrow("VALIDATION");
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({
      businessId: biz.id, planId: free.id, status: "active", trialEndsAt: null,
      currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    // The owner seat exists only as a membership when seeded; the cap counts
    // live memberships, so seed one owner membership then fill the Free cap (3).
    await db.createMembership({ businessId: biz.id, userId: "u1", role: "owner" });
    await svc.create(biz.id, "u1", "r-a", OWNER, { email: `m1-${Date.now()}@x.test`, name: "M1", role: "cashier" });
    await svc.create(biz.id, "u1", "r-b", OWNER, { email: `m2-${Date.now()}@x.test`, name: "M2", role: "cashier" });
    await expect(
      svc.create(biz.id, "u1", "r-cap", OWNER, { email: `m3-${Date.now()}@x.test`, name: "M3", role: "cashier" }),
    ).rejects.toThrow("PLAN_LIMIT");
    const members = await svc.list(biz.id);
    const cashier = members.items.find((m) => m.role === "cashier")!;
    await svc.deactivate(biz.id, "u1", "r-deact", OWNER, cashier.id);
    const ok = await svc.create(biz.id, "u1", "r-after", OWNER, {
      email: `m4-${Date.now()}@x.test`, name: "M4", role: "cashier",
    });
    expect(ok.membershipId).toBeTruthy();
  });

  it("refuses to deactivate the last active owner", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const svc = new MembershipService(db);
    const out = await svc.create(biz.id, "u1", "r1", OWNER, {
      email: `own${Date.now()}@x.test`, name: "Solo", role: "manager",
    });
    const ownerMem = await db.createMembership({ businessId: biz.id, userId: "u1", role: "owner" });
    await expect(svc.deactivate(biz.id, "u1", "r2", OWNER, ownerMem.id)).rejects.toThrow("VALIDATION");
    const members = await svc.list(biz.id);
    expect(members.items.find((m) => m.id === out.membershipId)!.deactivatedAt).toBeNull();
  });

  it("does not exceed the user cap under concurrent invites", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Concurrent Seats", currency: "PHP" });
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({
      businessId: biz.id,
      planId: free.id,
      status: "active",
      trialEndsAt: null,
      currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    await db.createMembership({ businessId: biz.id, userId: "owner-1", role: "owner" });
    await db.createMembership({ businessId: biz.id, userId: "manager-1", role: "manager" });
    const svc = new MembershipService(db);

    const outcomes = await Promise.allSettled([
      svc.create(biz.id, "owner-1", "r-a", OWNER, {
        email: `seat-a-${Date.now()}@x.test`, name: "Seat A", role: "cashier",
      }),
      svc.create(biz.id, "owner-1", "r-b", OWNER, {
        email: `seat-b-${Date.now()}@x.test`, name: "Seat B", role: "cashier",
      }),
    ]);

    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await svc.list(biz.id)).items).toHaveLength(3);
  });

  it("enrolls and rotates a hashed approval PIN only for active owner/manager memberships", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "PIN Store", currency: "PHP" });
    const managerUser = await db.createUser({
      name: "Manager", email: "pin-manager@example.com", passwordHash: "unused-password-hash",
    });
    const cashierUser = await db.createUser({
      name: "Cashier", email: "pin-cashier@example.com", passwordHash: "unused-password-hash",
    });
    const manager = await db.createMembership({ businessId: biz.id, userId: managerUser.id, role: "manager", deactivatedAt: null });
    const cashier = await db.createMembership({ businessId: biz.id, userId: cashierUser.id, role: "cashier", deactivatedAt: null });
    const svc = new MembershipService(db);

    await svc.setApprovalPin(biz.id, "owner-1", "pin-r1", OWNER, manager.id, "482615");
    const stored = await db.findMembership(managerUser.id, biz.id);
    expect(stored?.approvalPinHash).toBeTruthy();
    expect(stored?.approvalPinHash).not.toContain("482615");
    expect(await verifyApprovalPin(stored!.approvalPinHash!, "482615")).toBe(true);
    expect((await svc.list(biz.id)).items.find((item) => item.id === manager.id)?.approvalPinSet).toBe(true);

    await svc.setApprovalPin(biz.id, "owner-1", "pin-r2", OWNER, manager.id, "593726");
    const rotated = await db.findMembership(managerUser.id, biz.id);
    expect(await verifyApprovalPin(rotated!.approvalPinHash!, "482615")).toBe(false);
    expect(await verifyApprovalPin(rotated!.approvalPinHash!, "593726")).toBe(true);

    await expect(svc.setApprovalPin(biz.id, "owner-1", "pin-r3", OWNER, cashier.id, "482615")).rejects.toThrow("VALIDATION");
    await expect(svc.setApprovalPin(biz.id, "owner-1", "pin-r4", ["sale.refund"], manager.id, "482615")).rejects.toThrow("FORBIDDEN");
    await db.updateMembership(manager.id, biz.id, { deactivatedAt: new Date() });
    await expect(svc.setApprovalPin(biz.id, "owner-1", "pin-r5", OWNER, manager.id, "482615")).rejects.toThrow("NOT_FOUND");
  });
});

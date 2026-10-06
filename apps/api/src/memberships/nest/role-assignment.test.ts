import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { MembershipService } from "./membership.service";

const OWNER_PERMISSIONS = ["user.manage", "settings.write", "sale.refund"];

describe("role assignments", () => {
  it("creates an auditable temporary role without replacing the permanent role", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Assignments", currency: "PHP" });
    await db.createMembership({ businessId: business.id, userId: "owner-1", role: "owner" });
    const service = new MembershipService(db);
    const member = await service.create(business.id, "owner-1", "invite-1", OWNER_PERMISSIONS, {
      email: "maria@example.com",
      name: "Maria",
      role: "cashier",
    });

    const expiresAt = new Date("2030-01-02T00:00:00.000Z");
    const first = await service.assignRole(business.id, "owner-1", "assign-1", OWNER_PERMISSIONS, member.membershipId, {
      role: "manager",
      assignmentType: "TEMPORARY",
      startsAt: new Date("2030-01-01T00:00:00.000Z"),
      expiresAt,
      reason: "Temporary coverage while hiring",
      idempotencyKey: "maria-manager-coverage",
    });
    const replay = await service.assignRole(business.id, "owner-1", "assign-2", OWNER_PERMISSIONS, member.membershipId, {
      role: "manager",
      assignmentType: "TEMPORARY",
      startsAt: new Date("2030-01-01T00:00:00.000Z"),
      expiresAt,
      reason: "Temporary coverage while hiring",
      idempotencyKey: "maria-manager-coverage",
    });

    expect(replay.id).toBe(first.id);
    expect((await service.listRoleAssignments(business.id, member.membershipId)).items).toEqual([
      expect.objectContaining({ role: "cashier", assignmentType: "PERMANENT", revokedAt: null }),
      expect.objectContaining({
        role: "manager",
        assignmentType: "TEMPORARY",
        expiresAt,
        assignedBy: "owner-1",
        assignmentReason: "Temporary coverage while hiring",
        revokedAt: null,
      }),
    ]);
  });

  it("revokes a role assignment without changing the member identity", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Revocations", currency: "PHP" });
    await db.createMembership({ businessId: business.id, userId: "owner-1", role: "owner" });
    const service = new MembershipService(db);
    const member = await service.create(business.id, "owner-1", "invite-2", OWNER_PERMISSIONS, {
      email: "maria-revoke@example.com",
      name: "Maria",
      role: "cashier",
    });
    const assignment = await service.assignRole(business.id, "owner-1", "assign-2", OWNER_PERMISSIONS, member.membershipId, {
      role: "manager",
      assignmentType: "TEMPORARY",
      expiresAt: new Date("2030-01-02T00:00:00.000Z"),
      reason: "Coverage",
      idempotencyKey: "maria-revoke-manager",
    });

    await service.revokeRole(business.id, "owner-1", "revoke-1", OWNER_PERMISSIONS, assignment.id, "Coverage ended");

    expect((await service.listRoleAssignments(business.id, member.membershipId)).items).toEqual([
      expect.objectContaining({ role: "cashier", revokedAt: null }),
      expect.objectContaining({ role: "manager", revokedBy: "owner-1", revocationReason: "Coverage ended" }),
    ]);
    expect((await db.findMembership(member.userId, business.id))?.role).toBe("cashier");
  });

  it("rejects idempotency-key reuse with a different normalized command", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Idempotency", currency: "PHP" });
    await db.createMembership({ businessId: business.id, userId: "owner-1", role: "owner" });
    const service = new MembershipService(db);
    const member = await service.create(business.id, "owner-1", "invite-idem", OWNER_PERMISSIONS, {
      email: "maria-idem@example.com", name: "Maria", role: "cashier",
    });
    const common = { assignmentType: "TEMPORARY" as const, expiresAt: new Date("2030-01-02T00:00:00.000Z"), reason: "Coverage", idempotencyKey: "same-key" };
    await service.assignRole(business.id, "owner-1", "assign-idem-1", OWNER_PERMISSIONS, member.membershipId, { role: "manager", ...common });
    await expect(service.assignRole(business.id, "owner-1", "assign-idem-2", OWNER_PERMISSIONS, member.membershipId, { role: "inventory", ...common })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("requires expiry and reason for temporary delegation", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Validation", currency: "PHP" });
    await db.createMembership({ businessId: business.id, userId: "owner-1", role: "owner" });
    const service = new MembershipService(db);
    const member = await service.create(business.id, "owner-1", "invite-validation", OWNER_PERMISSIONS, {
      email: "maria-validation@example.com", name: "Maria", role: "cashier",
    });
    await expect(service.assignRole(business.id, "owner-1", "assign-validation", OWNER_PERMISSIONS, member.membershipId, {
      role: "manager", assignmentType: "TEMPORARY", reason: "",
    })).rejects.toThrow("VALIDATION");
  });

  it("deactivates a member and revokes the member's active sessions", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Offboarding", currency: "PHP" });
    await db.createMembership({ businessId: business.id, userId: "owner-1", role: "owner" });
    const service = new MembershipService(db);
    const member = await service.create(business.id, "owner-1", "invite-3", OWNER_PERMISSIONS, {
      email: "maria-offboard@example.com",
      name: "Maria",
      role: "cashier",
    });
    await db.createSession({
      userId: member.userId,
      businessId: business.id,
      tokenHash: "session-hash",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      revokedAt: null,
      authenticatedAt: new Date("2029-01-01T00:00:00.000Z"),
      ip: null,
      userAgent: null,
    });

    await service.deactivate(business.id, "owner-1", "deactivate-1", OWNER_PERMISSIONS, member.membershipId);

    expect(await db.listSessionsByUser(member.userId)).toHaveLength(0);
    expect((await db.listMembershipsByBusiness(business.id)).find((item) => item.id === member.membershipId)?.deactivatedAt).toBeInstanceOf(Date);
  });
});

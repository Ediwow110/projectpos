import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";
import type { DbRoleAssignment, RoleAssignmentType } from "../../common/db.port";
import { hashApprovalPin } from "../../auth/approval-pin";
import { hashPassword } from "../../auth/password";
import { BillingService } from "../../billing/nest/billing.service";

const ASSIGNABLE_ROLES = new Set(["manager", "cashier", "inventory"]);

export interface MembershipCreateInput {
  email: string;
  name: string;
  role: string;
}

export interface RoleAssignmentInput {
  role: string;
  assignmentType: RoleAssignmentType;
  branchId?: string | null;
  startsAt?: Date;
  expiresAt?: Date | null;
  reason?: string | null;
  idempotencyKey?: string | null;
}

@Injectable()
export class MembershipService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  // FR-RBAC-02: user management is a permission-sensitive action. The seat is
  // counted and capped through the same entitlement path as every other cap
  // (PLAN 16.2), which makes this the live caller of the `users` cap.
  async create(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    input: MembershipCreateInput,
  ): Promise<{ membershipId: string; userId: string; tempPassword?: string }> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!email.includes("@") || !name || name.length > 80) throw new Error("VALIDATION");
    if (!ASSIGNABLE_ROLES.has(input.role)) throw new Error("VALIDATION");
    const candidateTempPassword = randomBytes(12).toString("base64url").slice(0, 16);
    const candidatePasswordHash = await hashPassword(candidateTempPassword);
    const created = await new BillingService(this.db).withCap(
      businessId,
      actorId,
      requestId,
      "users",
      async () => {
        const existing = await this.db.findUserByEmail(email);
        let userId: string;
        let tempPassword: string | undefined;
        if (existing) {
          userId = existing.id;
        } else {
          const user = await this.db.createUser({
            name,
            email,
            passwordHash: candidatePasswordHash,
            emailVerified: true,
          });
          userId = user.id;
          tempPassword = candidateTempPassword;
        }
        const membership = await this.db.createMembership({ businessId, userId, role: input.role });
        await this.db.createRoleAssignment({
          businessId,
          membershipId: membership.id,
          role: input.role,
          assignmentType: "PERMANENT",
          branchId: null,
          startsAt: new Date(),
          expiresAt: null,
          assignedBy: actorId,
          assignedAt: new Date(),
          assignmentReason: "Initial membership role",
          revokedAt: null,
          revokedBy: null,
          revocationReason: null,
          idempotencyKey: `membership:${membership.id}:initial`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return { membership, userId, tempPassword };
      },
    );
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "member.invited",
      entityType: "BusinessMembership",
      entityId: created.membership.id,
      requestId,
      reason: `role ${input.role}${created.tempPassword ? " (new user)" : " (existing user)"}`,
    });
    return {
      membershipId: created.membership.id,
      userId: created.userId,
      ...(created.tempPassword ? { tempPassword: created.tempPassword } : {}),
    };
  }

  async list(businessId: string): Promise<{
    items: Array<{ id: string; userId: string; name: string; email: string; role: string; roles: string[]; assignments: DbRoleAssignment[]; deactivatedAt: Date | null; approvalPinSet: boolean }>;
  }> {
    withScope(businessId, {});
    const members = await this.db.listMembershipsByBusiness(businessId);
    const items = [];
    for (const m of members) {
      const user = await this.db.findUserById(m.userId);
      const assignments = await this.db.listRoleAssignments(m.id, businessId);
      const now = new Date();
      items.push({
        id: m.id,
        userId: m.userId,
        name: user?.name ?? "",
        email: user?.email ?? "",
        role: m.role,
        roles: [...new Set(assignments.filter((a) => a.revokedAt === null && a.startsAt.getTime() <= now.getTime() && (a.expiresAt === null || a.expiresAt.getTime() > now.getTime())).map((a) => a.role))],
        assignments,
        deactivatedAt: m.deactivatedAt ?? null,
        approvalPinSet: Boolean(m.approvalPinHash),
      });
    }
    return { items };
  }

  async listRoleAssignments(businessId: string, membershipId: string): Promise<{ items: DbRoleAssignment[] }> {
    withScope(businessId, {});
    return { items: await this.db.listRoleAssignments(membershipId, businessId) };
  }

  async assignRole(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    membershipId: string,
    input: RoleAssignmentInput,
  ): Promise<DbRoleAssignment> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    if (!ASSIGNABLE_ROLES.has(input.role)) throw new Error("VALIDATION");
    if (input.assignmentType === "PERMANENT" && input.expiresAt) throw new Error("VALIDATION");
    if (input.assignmentType === "TEMPORARY" && (!input.expiresAt || !input.reason?.trim())) throw new Error("VALIDATION");
    const startsAt = input.startsAt ?? new Date();
    if (input.expiresAt && input.expiresAt.getTime() <= startsAt.getTime()) throw new Error("VALIDATION");
    if (input.assignmentType === "TEMPORARY" && input.reason && input.reason.trim().length > 240) throw new Error("VALIDATION");
    if (input.branchId && !(await this.db.findBranchById(input.branchId, businessId))) throw new Error("NOT_FOUND");

    return this.db.withLock(`role-assignment:${businessId}:${membershipId}`, async () => {
      const membership = (await this.db.listMembershipsByBusiness(businessId)).find((m) => m.id === membershipId);
      if (!membership) throw new Error("NOT_FOUND");
      if (membership.deactivatedAt) throw new Error("VALIDATION");
      const assignments = await this.db.listRoleAssignments(membershipId, businessId);
      const replay = input.idempotencyKey ? assignments.find((a) => a.idempotencyKey === input.idempotencyKey) : null;
      if (replay) {
        const sameCommand = replay.role === input.role &&
          replay.assignmentType === input.assignmentType &&
          replay.branchId === (input.branchId ?? null) &&
          replay.startsAt.getTime() === startsAt.getTime() &&
          (replay.expiresAt?.getTime() ?? null) === (input.expiresAt?.getTime() ?? null) &&
          replay.assignmentReason === (input.reason?.trim() || null);
        if (!sameCommand) throw new Error("IDEMPOTENCY_CONFLICT");
        return replay;
      }
      const now = new Date();
      const duplicate = assignments.find((a) =>
        a.role === input.role &&
        a.branchId === (input.branchId ?? null) &&
        a.revokedAt === null &&
        (a.expiresAt === null || a.expiresAt.getTime() > now.getTime()) &&
        a.startsAt.getTime() <= now.getTime(),
      );
      if (duplicate) return duplicate;
      const assignment = await this.db.createRoleAssignment({
        businessId,
        membershipId,
        role: input.role,
        assignmentType: input.assignmentType,
        branchId: input.branchId ?? null,
        startsAt,
        expiresAt: input.expiresAt ?? null,
        assignedBy: actorId,
        assignedAt: now,
        assignmentReason: input.reason?.trim() || null,
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await this.db.appendAudit({
        businessId,
        actorId,
        action: input.assignmentType === "TEMPORARY" ? "member.role.delegated" : "member.role.assigned",
        entityType: "RoleAssignment",
        entityId: assignment.id,
        requestId,
        reason: input.reason?.trim() || `role ${input.role}`,
        after: { role: input.role, assignmentType: input.assignmentType, branchId: input.branchId ?? null, expiresAt: input.expiresAt ?? null },
      });
      return assignment;
    });
  }

  async revokeRole(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    assignmentId: string,
    reason: string,
  ): Promise<DbRoleAssignment> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    const memberships = await this.db.listMembershipsByBusiness(businessId);
    for (const membership of memberships) {
      const assignment = (await this.db.listRoleAssignments(membership.id, businessId)).find((a) => a.id === assignmentId);
      if (!assignment) continue;
      if (assignment.role === "owner") throw new Error("VALIDATION");
      if (assignment.revokedAt) return assignment;
      const updated = await this.db.updateRoleAssignment(assignmentId, businessId, {
        revokedAt: new Date(),
        revokedBy: actorId,
        revocationReason: reason.trim().slice(0, 240),
      });
      if (!updated) throw new Error("NOT_FOUND");
      await this.db.revokeAllUserSessions(membership.userId);
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "member.role.revoked",
        entityType: "RoleAssignment",
        entityId: assignmentId,
        requestId,
        reason: reason.trim().slice(0, 240),
        before: { role: assignment.role, assignmentType: assignment.assignmentType },
      });
      return updated;
    }
    throw new Error("NOT_FOUND");
  }

  async setApprovalPin(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    membershipId: string,
    pin: string,
  ): Promise<{ ok: true }> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    const members = await this.db.listMembershipsByBusiness(businessId);
    const target = members.find((member) => member.id === membershipId && !member.deactivatedAt);
    if (!target) throw new Error("NOT_FOUND");
    const assignments = await this.db.listRoleAssignments(target.id, businessId);
    const now = new Date();
    const hasManagerRole = assignments.some((assignment) => assignment.role === "manager" && assignment.revokedAt === null && assignment.startsAt.getTime() <= now.getTime() && (assignment.expiresAt === null || assignment.expiresAt.getTime() > now.getTime()));
    if (target.role !== "owner" && target.role !== "manager" && !hasManagerRole) throw new Error("VALIDATION");
    const approvalPinHash = await hashApprovalPin(pin);
    await this.db.updateMembership(membershipId, businessId, { approvalPinHash });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "member.approval-pin.updated",
      entityType: "BusinessMembership",
      entityId: membershipId,
      requestId,
      reason: `role ${target.role}`,
      after: { approvalPinSet: true },
    });
    return { ok: true };
  }

  async deactivate(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    membershipId: string,
  ): Promise<{ ok: true }> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    const members = (await this.db.listMembershipsByBusiness(businessId)).filter((m) => !m.deactivatedAt);
    const target = members.find((m) => m.id === membershipId);
    if (!target) throw new Error("NOT_FOUND");
    const activeOwners = members.filter((m) => m.role === "owner");
    if (target.role === "owner" && activeOwners.length <= 1) {
      throw new Error("VALIDATION");
    }
    await this.db.updateMembership(membershipId, businessId, { deactivatedAt: new Date() });
    await this.db.revokeAllUserSessions(target.userId);
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "member.deactivated",
      entityType: "BusinessMembership",
      entityId: membershipId,
      requestId,
      reason: `role ${target.role}`,
    });
    return { ok: true };
  }

  async reactivate(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    membershipId: string,
  ): Promise<{ ok: true }> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    const target = (await this.db.listMembershipsByBusiness(businessId)).find((m) => m.id === membershipId);
    if (!target) throw new Error("NOT_FOUND");
    await this.db.updateMembership(membershipId, businessId, { deactivatedAt: null });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "member.reactivated",
      entityType: "BusinessMembership",
      entityId: membershipId,
      requestId,
      reason: "membership reactivated",
    });
    return { ok: true };
  }
}

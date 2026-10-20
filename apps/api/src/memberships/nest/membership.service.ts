import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";
import { hashApprovalPin } from "../../auth/approval-pin";
import { hashPassword } from "../../auth/password";
import { BillingService } from "../../billing/nest/billing.service";
import {
  MEMBER_DENIALS_KEY, MEMBER_BRANCHES_KEY, MEMBER_REGISTERS_KEY,
  assignedBranches, assignedRegisters, deniedPermissions,
} from "../../auth/member-permissions";
import { ROLE_SEED } from "../../tenant/seed";

const ASSIGNABLE_ROLES = new Set(["manager", "cashier", "inventory"]);

export interface MembershipCreateInput {
  email: string;
  name: string;
  role: string;
}

@Injectable()
export class MembershipService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async getRegisterAssignment(
    businessId: string, membershipId: string,
  ): Promise<{ registerIds: string[] | null }> {
    withScope(businessId, {});
    const target = (await this.db.listMembershipsByBusiness(businessId))
      .find((member) => member.id === membershipId && !member.deactivatedAt);
    if (!target) throw new Error("NOT_FOUND");
    return { registerIds: assignedRegisters(await this.db.getSettings(businessId), membershipId) ?? null };
  }

  async setRegisterAssignment(
    businessId: string, actorId: string, requestId: string, granted: string[],
    membershipId: string, registerIds: string[] | null,
  ): Promise<{ registerIds: string[] | null }> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    return this.db.withLock(`business-settings:${businessId}`, async () => {
      const target = (await this.db.listMembershipsByBusiness(businessId))
        .find((member) => member.id === membershipId && !member.deactivatedAt);
      if (!target) throw new Error("NOT_FOUND");
      if (target.role === "owner" || target.userId === actorId) throw new Error("FORBIDDEN");
      const settings = await this.db.getSettings(businessId);
      const branches = assignedBranches(settings, membershipId);
      // A register allowlist only makes sense inside an enforced branch set.
      if (branches === undefined && registerIds !== null) throw new Error("VALIDATION");
      if (registerIds !== null) {
        if (registerIds.length > 50 || new Set(registerIds).size !== registerIds.length) throw new Error("VALIDATION");
        for (const registerId of registerIds) {
          const register = await this.db.findRegisterById(registerId, businessId);
          if (!register || !register.isActive || !register.branchId || !branches?.includes(register.branchId)) {
            throw new Error("VALIDATION");
          }
        }
      }
      const old = assignedRegisters(settings, membershipId) ?? null;
      if (JSON.stringify(old) === JSON.stringify(registerIds)) return { registerIds };
      const raw = settings[MEMBER_REGISTERS_KEY];
      const map = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
      const updated = { ...map };
      if (registerIds === null) delete updated[membershipId];
      else updated[membershipId] = [...registerIds];
      await this.db.saveSettings(businessId, { ...settings, [MEMBER_REGISTERS_KEY]: updated });
      await this.db.appendAudit({
        businessId, actorId, requestId,
        action: "member.registers.changed", entityType: "BusinessMembership",
        entityId: membershipId,
        before: { registerIds: old }, after: { registerIds },
        reason: "Owner updated employee register access",
      });
      return { registerIds };
    });
  }

  async getBranchAssignment(
    businessId: string,
    membershipId: string,
  ): Promise<{ branchIds: string[] | null }> {
    withScope(businessId, {});
    const target = (await this.db.listMembershipsByBusiness(businessId))
      .find((member) => member.id === membershipId && !member.deactivatedAt);
    if (!target) throw new Error("NOT_FOUND");
    const branchIds = assignedBranches(await this.db.getSettings(businessId), membershipId);
    return { branchIds: branchIds ?? null };
  }

  async setBranchAssignment(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    membershipId: string,
    branchIds: string[] | null,
  ): Promise<{ branchIds: string[] | null }> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    return this.db.withLock(`business-settings:${businessId}`, async () => {
      const target = (await this.db.listMembershipsByBusiness(businessId))
        .find((member) => member.id === membershipId && !member.deactivatedAt);
      if (!target) throw new Error("NOT_FOUND");
      if (target.role === "owner" || target.userId === actorId) throw new Error("FORBIDDEN");
      if (branchIds && (new Set(branchIds).size !== branchIds.length || branchIds.length > 25)) {
        throw new Error("VALIDATION");
      }
      for (const id of branchIds ?? []) {
        const branch = await this.db.findBranchById(id, businessId);
        if (!branch || !branch.isActive) throw new Error("VALIDATION");
      }
      const settings = await this.db.getSettings(businessId);
      const oldBranchIds = assignedBranches(settings, membershipId) ?? null;
      const existingRegisters = assignedRegisters(settings, membershipId);
      if (branchIds !== null && existingRegisters) {
        for (const id of existingRegisters) {
          const register = await this.db.findRegisterById(id, businessId);
          if (!register?.branchId || !branchIds.includes(register.branchId)) {
            throw new Error("VALIDATION");
          }
        }
      }
      if (JSON.stringify(oldBranchIds) === JSON.stringify(branchIds)) return { branchIds };
      const raw = settings[MEMBER_BRANCHES_KEY];
      const existing = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
      const updated = { ...existing };
      if (branchIds === null) delete updated[membershipId];
      else updated[membershipId] = [...branchIds];
      const registerMap = settings[MEMBER_REGISTERS_KEY];
      const nextRegisterMap = registerMap && typeof registerMap === "object" && !Array.isArray(registerMap)
        ? { ...(registerMap as Record<string, unknown>) } : {};
      // Reverting to all-branch access also clears a dependent register
      // restriction. Never silently leave a stale register-only policy.
      if (branchIds === null) delete nextRegisterMap[membershipId];
      await this.db.saveSettings(businessId, {
        ...settings,
        [MEMBER_BRANCHES_KEY]: updated,
        [MEMBER_REGISTERS_KEY]: nextRegisterMap,
      });
      await this.db.appendAudit({
        businessId, actorId, requestId,
        action: "member.branches.changed",
        entityType: "BusinessMembership", entityId: membershipId,
        before: { branchIds: oldBranchIds, registerIds: existingRegisters ?? null },
        after: {
          branchIds,
          registerIds: branchIds === null ? null : existingRegisters ?? null,
        },
        reason: "Owner updated employee branch access",
      });
      return { branchIds };
    });
  }

  async listOwnerAudit(
    businessId: string,
    limit: number,
    actionFilter?: string,
  ): Promise<{ items: Array<{
    at: string; actorId: string; action: string; entityType: string;
    entityId: string; requestId: string;
  }> }> {
    withScope(businessId, {});
    const rows = (await this.db.listAudit(businessId))
      .filter((entry) => entry.businessId === businessId &&
        (!actionFilter || entry.action.toLowerCase().includes(actionFilter.toLowerCase())))
      .sort((left, right) => (right.at?.getTime() ?? 0) - (left.at?.getTime() ?? 0))
      .slice(0, limit);
    // Never surface before/after snapshots through the general owner feed:
    // existing audit entries may contain settings, credentials or personal data.
    return { items: rows.map((entry) => ({
      at: entry.at?.toISOString() ?? "",
      actorId: entry.actorId, action: entry.action,
      entityType: entry.entityType, entityId: entry.entityId,
      requestId: entry.requestId,
    })) };
  }

  async getPermissionRestrictions(
    businessId: string,
    membershipId: string,
  ): Promise<{ role: string; deniedPermissions: string[]; rolePermissions: string[] }> {
    withScope(businessId, {});
    const membership = (await this.db.listMembershipsByBusiness(businessId))
      .find((row) => row.id === membershipId && !row.deactivatedAt);
    if (!membership) throw new Error("NOT_FOUND");
    const currentRolePermissions = ROLE_SEED[membership.role as keyof typeof ROLE_SEED] ?? [];
    return {
      role: membership.role,
      deniedPermissions: deniedPermissions(await this.db.getSettings(businessId), membership.id)
        .filter((permission) => currentRolePermissions.includes(permission)),
      rolePermissions: currentRolePermissions,
    };
  }

  async setPermissionRestrictions(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    membershipId: string,
    denied: string[],
  ): Promise<{ role: string; deniedPermissions: string[] }> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    // Serialize with other business-settings editors to avoid overwriting a
    // concurrent settings update when writing this tenant-scoped JSON policy.
    return this.db.withLock(`business-settings:${businessId}`, async () => {
      const target = (await this.db.listMembershipsByBusiness(businessId))
        .find((row) => row.id === membershipId && !row.deactivatedAt);
      if (!target) throw new Error("NOT_FOUND");
      // The owner role and the actor's own access are never editable.
      if (target.role === "owner" || target.userId === actorId) throw new Error("FORBIDDEN");
      const baseline = ROLE_SEED[target.role as keyof typeof ROLE_SEED] ?? [];
      if (denied.length > 80 || new Set(denied).size !== denied.length ||
          !denied.every((permission) => baseline.includes(permission))) {
        throw new Error("VALIDATION");
      }
      const settings = await this.db.getSettings(businessId);
      const oldDenied = deniedPermissions(settings, membershipId);
      if (oldDenied.length === denied.length && oldDenied.every((value) => denied.includes(value))) {
        return { role: target.role, deniedPermissions: oldDenied };
      }
      const raw = settings[MEMBER_DENIALS_KEY];
      const map = raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
      const next = { ...map, [membershipId]: [...denied] };
      await this.db.saveSettings(businessId, { ...settings, [MEMBER_DENIALS_KEY]: next });
      await this.db.appendAudit({
        businessId, actorId, requestId,
        action: "member.permissions.restricted",
        entityType: "BusinessMembership",
        entityId: membershipId,
        before: { role: target.role, deniedPermissions: oldDenied },
        after: { role: target.role, deniedPermissions: denied },
        reason: "Owner updated deny-only permission restrictions",
      });
      return { role: target.role, deniedPermissions: denied };
    });
  }

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
    items: Array<{ id: string; userId: string; name: string; email: string; role: string; deactivatedAt: Date | null; approvalPinSet: boolean }>;
  }> {
    withScope(businessId, {});
    const members = (await this.db.listMembershipsByBusiness(businessId)).filter((m) => !m.deactivatedAt);
    const items = [];
    for (const m of members) {
      const user = await this.db.findUserById(m.userId);
      items.push({
        id: m.id,
        userId: m.userId,
        name: user?.name ?? "",
        email: user?.email ?? "",
        role: m.role,
        deactivatedAt: m.deactivatedAt ?? null,
        approvalPinSet: Boolean(m.approvalPinHash),
      });
    }
    return { items };
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
    if (target.role !== "owner" && target.role !== "manager") throw new Error("VALIDATION");
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

  async changeRole(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    membershipId: string,
    role: string,
  ): Promise<{ ok: true; role: string }> {
    withScope(businessId, {});
    if (!granted.includes("user.manage")) throw new Error("FORBIDDEN");
    if (!ASSIGNABLE_ROLES.has(role)) throw new Error("VALIDATION");
    return this.db.withLock(`membership-role:${businessId}:${membershipId}`, async () => {
      const members = await this.db.listMembershipsByBusiness(businessId);
      const target = members.find((member) => member.id === membershipId && !member.deactivatedAt);
      if (!target) throw new Error("NOT_FOUND");
      // No self-promotion, owner demotion, or changes to protected memberships.
      if (target.userId === actorId || target.role === "owner") throw new Error("FORBIDDEN");
      if (target.role === role) return { ok: true, role };
      const previousRole = target.role;
      // Clear any existing manager credential when changing role. Reenroll
      // a manager's PIN separately rather than carrying stale approval power.
      await this.db.updateMembership(membershipId, businessId, {
        role: role as "manager" | "cashier" | "inventory",
        approvalPinHash: null,
      });
      await this.db.appendAudit({
        businessId, actorId, requestId,
        action: "member.role.changed",
        entityType: "BusinessMembership",
        entityId: membershipId,
        before: { role: previousRole, approvalPinSet: Boolean(target.approvalPinHash) },
        after: { role, approvalPinSet: false },
        reason: "Owner updated employee role",
      });
      return { ok: true, role };
    });
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
}

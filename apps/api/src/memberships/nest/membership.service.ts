import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";
import { hashApprovalPin } from "../../auth/approval-pin";
import { hashPassword } from "../../auth/password";
import { BillingService } from "../../billing/nest/billing.service";

const ASSIGNABLE_ROLES = new Set(["manager", "cashier", "inventory"]);

export interface MembershipCreateInput {
  email: string;
  name: string;
  role: string;
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

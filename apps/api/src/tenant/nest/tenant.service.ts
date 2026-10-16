import { Inject, Injectable } from "@nestjs/common";
import { configuredOnboardingState, isOnboardingComplete } from "../../business/onboarding";
import type { DbPort } from "../../common/db.port";
import { assignedBranches } from "../../auth/member-permissions";

@Injectable()
export class TenantService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async me(userId: string, businessId: string, activeBranchId: string | null = null): Promise<{
    userId: string;
    email: string;
    name: string;
    businessId: string;
    businessName: string;
    role: string;
    activeBranchId: string | null;
    activeBranchName: string | null;
    onboardingRequired: boolean;
    workspaceTourSeen: boolean;
  }> {
    const user = await this.db.findUserById(userId);
    const business = await this.db.findBusinessById(businessId);
    const membership = await this.db.findMembership(userId, businessId);
    if (!user || !business || !membership) throw new Error("TENANT_REQUIRED");
    const settings = await this.db.getSettings(businessId);
    const onboarding = configuredOnboardingState(settings);
    const activeBranch = activeBranchId ? await this.db.findBranchById(activeBranchId, businessId) : null;
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      businessId: business.id,
      businessName: business.name,
      role: membership.role,
      activeBranchId: activeBranch?.isActive ? activeBranch.id : null,
      activeBranchName: activeBranch?.isActive ? activeBranch.name : null,
      onboardingRequired: membership.role === "owner" && !isOnboardingComplete(onboarding),
      workspaceTourSeen: user.workspaceTourSeen === true,
    };
  }

  async setActiveBranch(
    userId: string,
    businessId: string,
    sessionId: string,
    branchId: string | null,
    requestId: string,
  ): Promise<{ activeBranchId: string | null; activeBranchName: string | null }> {
    const membership = await this.db.findMembership(userId, businessId);
    if (!membership || membership.deactivatedAt) throw new Error("FORBIDDEN");
    const allowed = membership.role === "owner"
      ? undefined : assignedBranches(await this.db.getSettings(businessId), membership.id);
    if (allowed && (branchId === null || !allowed.includes(branchId))) throw new Error("FORBIDDEN");
    if (branchId === null) {
      await this.db.updateSession(sessionId, { activeBranchId: null });
      await this.db.appendAudit({
        businessId,
        actorId: userId,
        action: "auth.switch-branch",
        entityType: "Session",
        entityId: sessionId,
        requestId,
        reason: "all branches",
      });
      return { activeBranchId: null, activeBranchName: null };
    }
    const branch = await this.db.findBranchById(branchId, businessId);
    if (!branch) throw new Error("NOT_FOUND");
    if (!branch.isActive) throw new Error("VALIDATION");
    await this.db.updateSession(sessionId, { activeBranchId: branch.id });
    await this.db.appendAudit({
      businessId,
      actorId: userId,
      action: "auth.switch-branch",
      entityType: "Session",
      entityId: sessionId,
      requestId,
      reason: branch.name,
    });
    return { activeBranchId: branch.id, activeBranchName: branch.name };
  }

  async markWorkspaceTourSeen(userId: string): Promise<{ workspaceTourSeen: true }> {
    const user = await this.db.findUserById(userId);
    if (!user) throw new Error("TENANT_REQUIRED");
    await this.db.setUserWorkspaceTourSeen(userId, true);
    return { workspaceTourSeen: true };
  }
}

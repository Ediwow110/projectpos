import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { isSessionExpired, isSessionRevoked } from "@pos/auth";
import { hashToken } from "../auth/sessions";
import { rolePermissionsForRoles } from "../tenant/seed";
import type { DbPort } from "./db.port";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    // Phase 10: ApiTokenGuard may have already authenticated a Bearer token
    // and set req.auth. Honor it instead of demanding a session cookie.
    if ((req.auth as { via?: string } | undefined)?.via === "api-token") return true;
    const token: string | undefined = req.cookies?.pos_session;
    if (!token) {
      req.authError = "TENANT_REQUIRED";
      return false;
    }
    const session = await this.db.findSessionByTokenHash(hashToken(token));
    if (!session) {
      req.authError = "TENANT_REQUIRED";
      return false;
    }
    if (isSessionExpired(session.expiresAt)) {
      req.authError = "SESSION_EXPIRED";
      return false;
    }
    if (isSessionRevoked(session.revokedAt)) {
      req.authError = "SESSION_REVOKED";
      return false;
    }
    if (process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"] === "1") {
      const user = await this.db.findUserById(session.userId);
      if (!user || user.emailVerified === false) {
        req.authError = "EMAIL_UNVERIFIED";
        return false;
      }
    }
    // FR-TENANT-02: the active business is whatever the user switched to on
    // this session, falling back to the login home business.
    const targetBusinessId = session.activeBusinessId ?? session.businessId;
    const membership = await this.db.findMembership(session.userId, targetBusinessId);
    // Phase 11: a deactivated member has no access, same as no membership.
    if (!membership || membership.deactivatedAt) {
      req.authError = "TENANT_MISMATCH";
      return false;
    }
    let activeBranchId = session.activeBranchId ?? null;
    if (activeBranchId !== null) {
      const branch = await this.db.findBranchById(activeBranchId, targetBusinessId);
      if (!branch || !branch.isActive) {
        activeBranchId = null;
        await this.db.updateSession(session.id, { activeBranchId: null });
      }
    }
    const assignments = await this.db.listActiveRoleAssignments(session.userId, targetBusinessId, activeBranchId, new Date());
    const allAssignments = await this.db.listRoleAssignments(membership.id, targetBusinessId);
    const roles = assignments.length > 0
      ? [...new Set(assignments.map((assignment) => assignment.role))]
      : allAssignments.length === 0 ? [membership.role] : [];
    const priority = ["owner", "manager", "cashier", "inventory"];
    const primaryRole = [...roles].sort((a, b) => priority.indexOf(a) - priority.indexOf(b))[0] ?? (allAssignments.length === 0 ? membership.role : "none");
    req.auth = {
      userId: session.userId,
      businessId: targetBusinessId,
      role: primaryRole,
      roles,
      sessionId: session.id,
      activeBranchId,
      authenticatedAt: session.authenticatedAt,
    };
    req.rolePermissions = rolePermissionsForRoles(roles);
    return true;
  }
}

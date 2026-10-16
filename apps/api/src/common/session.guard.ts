import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { isSessionExpired, isSessionRevoked } from "@pos/auth";
import { hashToken } from "../auth/sessions";
import { configuredOnboardingState, isOnboardingComplete } from "../business/onboarding";
import type { DbPort } from "./db.port";
import { assignedBranches, assignedRegisters, effectivePermissions } from "../auth/member-permissions";
import { permitsAssignedBranchRequest } from "../auth/branch-access-policy";

const SETUP_SETTINGS = new Set(["businessAddress", "businessPhone", "businessTimezone", "currency", "taxName", "taxRateBps", "standardReceiptConfirmed", "receiptHeader", "receiptFooter"]);

function isSetupSettingsPatch(body: unknown): boolean {
  return typeof body === "object" && body !== null && !Array.isArray(body) &&
    Object.keys(body).every((key) => SETUP_SETTINGS.has(key));
}

function isSetupRoute(method: string, path: string, body: unknown): boolean {
  if (method === "GET") {
    return ["/api/v1/me", "/api/v1/health", "/api/v1/business", "/api/v1/onboarding", "/api/v1/onboarding/readiness", "/api/v1/auth/sessions"].includes(path);
  }
  if (method === "PATCH") {
    return path === "/api/v1/onboarding" ||
      (path === "/api/v1/business/settings" && isSetupSettingsPatch(body));
  }
  if (method === "DELETE") return /^\/api\/v1\/auth\/sessions\/[^/]+$/.test(path);
  return method === "POST" && [
    "/api/v1/me/active-branch", "/api/v1/auth/logout", "/api/v1/auth/active-business", "/api/v1/auth/confirm-password",
  ].includes(path);
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    // Phase 10: ApiTokenGuard may have already authenticated a Bearer token.
    // It still needs the business setup check below.
    if ((req.auth as { via?: string } | undefined)?.via === "api-token") {
      return this.checkOnboarding(req);
    }
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
    // Assignments are applied to the server session on each request rather
    // than trusting a client-selected branch or stale session cookie.
    const settings = await this.db.getSettings(targetBusinessId);
    const allowedBranchIds = membership.role === "owner" ? undefined : assignedBranches(settings, membership.id);
    const registerAssignment = membership.role === "owner" ? undefined : assignedRegisters(settings, membership.id);
    let allowedRegisterIds: string[] | null = registerAssignment ?? null;
    if (registerAssignment && !allowedBranchIds) {
      req.authError = "FORBIDDEN";
      return false;
    }
    if (registerAssignment && allowedBranchIds) {
      const valid: string[] = [];
      for (const id of registerAssignment) {
        const register = await this.db.findRegisterById(id, targetBusinessId);
        if (register?.isActive && register.branchId && allowedBranchIds.includes(register.branchId)) {
          valid.push(id);
        }
      }
      allowedRegisterIds = valid;
    }
    if (allowedBranchIds) {
      const active: string[] = [];
      for (const id of allowedBranchIds) {
        const branch = await this.db.findBranchById(id, targetBusinessId);
        if (branch?.isActive) active.push(id);
      }
      if (active.length === 0) {
        req.authError = "FORBIDDEN";
        return false;
      }
      if (!activeBranchId || !active.includes(activeBranchId)) {
        activeBranchId = active[0]!;
        await this.db.updateSession(session.id, { activeBranchId });
      }
      if (!(await permitsAssignedBranchRequest(this.db, req, targetBusinessId, activeBranchId, allowedRegisterIds, active))) {
        req.authError = "FORBIDDEN";
        return false;
      }
    }
    // This is the effective permission boundary for every staff request.
    // Do not rely on hiding disabled buttons: controllers must check this
    // reduced set instead of reading the static role seed directly.
    const granted = effectivePermissions(membership.role, membership.id, settings);
    req.auth = {
      userId: session.userId,
      businessId: targetBusinessId,
      role: membership.role,
      sessionId: session.id,
      activeBranchId,
      authenticatedAt: session.authenticatedAt,
      effectivePermissions: granted,
      allowedBranchIds: allowedBranchIds ?? null,
      allowedRegisterIds,
    };
    req.rolePermissions = granted;
    return this.checkOnboarding(req, settings);
  }

  private async checkOnboarding(
    req: { auth: { businessId: string }; authError?: string; method: string; path: string; body?: unknown },
    sessionSettings?: Record<string, unknown>,
  ): Promise<boolean> {
    if (isSetupRoute(req.method, req.path, req.body)) return true;
    const settings = sessionSettings ?? await this.db.getSettings(req.auth.businessId);
    const onboarding = configuredOnboardingState(settings);
    if (isOnboardingComplete(onboarding)) return true;
    req.authError = "ONBOARDING_REQUIRED";
    return false;
  }
}

import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { isSessionExpired, isSessionRevoked } from "@pos/auth";
import { hashToken } from "../auth/sessions";
import { defaultOnboardingState, isOnboardingComplete, type OnboardingState } from "../business/onboarding";
import type { DbPort } from "./db.port";

const SETUP_SETTINGS = new Set(["currency", "taxName", "taxRateBps", "receiptHeader", "receiptFooter"]);

function isSetupSettingsPatch(body: unknown): boolean {
  return typeof body === "object" && body !== null && !Array.isArray(body) &&
    Object.keys(body).every((key) => SETUP_SETTINGS.has(key));
}

function isSetupRoute(method: string, path: string, body: unknown): boolean {
  if (method === "GET") {
    return ["/api/v1/me", "/api/v1/health", "/api/v1/business", "/api/v1/onboarding", "/api/v1/auth/sessions"].includes(path);
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
    req.auth = {
      userId: session.userId,
      businessId: targetBusinessId,
      role: membership.role,
      sessionId: session.id,
      activeBranchId,
      authenticatedAt: session.authenticatedAt,
    };
    return this.checkOnboarding(req);
  }

  private async checkOnboarding(req: { auth: { businessId: string }; authError?: string; method: string; path: string; body?: unknown }): Promise<boolean> {
    if (isSetupRoute(req.method, req.path, req.body)) return true;
    const settings = await this.db.getSettings(req.auth.businessId);
    const onboarding = (settings["onboarding"] as OnboardingState | undefined) ?? defaultOnboardingState();
    if (isOnboardingComplete(onboarding)) return true;
    req.authError = "ONBOARDING_REQUIRED";
    return false;
  }
}

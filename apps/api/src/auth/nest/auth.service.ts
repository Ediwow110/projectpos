import { Inject, Injectable } from "@nestjs/common";
import { hashPassword, verifyPassword } from "../password";
import { buildSessionRecord, hashToken, isReAuthFresh } from "../sessions";
import { consumeResetToken, createResetToken } from "../reset-tokens";
import { issueCsrfToken } from "../csrf";
import { buildRegistrationSeed, resolveActiveBusiness, ROLE_SEED } from "../../tenant/seed";
import type { DbPort } from "../../common/db.port";

@Injectable()
export class AuthService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async register(input: { ownerName: string; email: string; password: string; businessName: string }, meta: { requestId: string; ip: string | null; userAgent: string | null }): Promise<{ user: { id: string; email: string; name: string }; business: { id: string; name: string; currency: string }; token: string; csrfToken: string }> {
    const existing = await this.db.findUserByEmail(input.email);
    if (existing) throw new Error("AUTH_EMAIL_TAKEN");
    const seed = await buildRegistrationSeed(input);
    const user = await this.db.createUser({ name: seed.user.name, email: seed.user.email, passwordHash: seed.user.passwordHash });
    const business = await this.db.createBusiness({ name: seed.business.name, currency: seed.business.currency });
    for (const [roleName, permissions] of Object.entries(seed.roles)) {
      void roleName;
      void permissions;
    }
    await this.db.createMembership({ businessId: business.id, userId: user.id, role: seed.ownerRoleName });
    await this.db.saveSettings(business.id, { currency: seed.business.currency, onboarding: seed.onboarding });
    // Phase 10: every new business starts on a 14-day Pro trial. The memory
    // factory always seeds plans (as does migration 0011), so the row exists.
    const pro = await this.db.findPlanByKey("pro");
    const trialEndsAt = new Date(Date.now() + 14 * 86400000);
    const sub = await this.db.upsertSubscription({
      businessId: business.id,
      planId: pro!.id,
      status: "trialing",
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
    });
    await this.db.appendAudit({ businessId: business.id, actorId: user.id, action: "subscription.created", entityType: "Subscription", entityId: sub.id, requestId: meta.requestId });
    const rec = buildSessionRecord({ userId: user.id, businessId: business.id, ip: meta.ip, userAgent: meta.userAgent });
    const created = await this.db.createSession({
      userId: rec.userId,
      businessId: rec.businessId,
      tokenHash: rec.tokenHash,
      expiresAt: rec.expiresAt,
      revokedAt: null,
      authenticatedAt: rec.createdAt,
      ip: rec.ip,
      userAgent: rec.userAgent,
      deviceId: null,
    });
    void created;
    await this.db.appendAudit({ businessId: business.id, actorId: user.id, action: "auth.register", entityType: "User", entityId: user.id, requestId: meta.requestId });
    await this.db.appendAudit({ businessId: business.id, actorId: user.id, action: "business.create", entityType: "Business", entityId: business.id, requestId: meta.requestId });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      business: { id: business.id, name: business.name, currency: business.currency },
      token: rec.token,
      csrfToken: issueCsrfToken(),
    };
  }

  async login(input: { email: string; password: string }, meta: { requestId: string; ip: string | null; userAgent: string | null }, deviceId?: string): Promise<{ token: string; csrfToken: string; userId: string; businessId: string }> {
    const user = await this.db.findUserByEmail(input.email);
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }
    const memberships = await this.db.listMembershipsByUser(user.id);
    if (memberships.length === 0) throw new Error("TENANT_REQUIRED");
    const businessId = memberships[0].businessId;
    if (deviceId !== undefined) {
      const device = await this.db.findDeviceById(deviceId, businessId);
      if (!device || device.userId !== user.id || device.revokedAt !== null) {
        throw new Error("FORBIDDEN");
      }
    }
    const rec = buildSessionRecord({ userId: user.id, businessId, ip: meta.ip, userAgent: meta.userAgent });
    await this.db.createSession({
      userId: rec.userId,
      businessId: rec.businessId,
      tokenHash: rec.tokenHash,
      expiresAt: rec.expiresAt,
      revokedAt: null,
      authenticatedAt: rec.createdAt,
      ip: rec.ip,
      userAgent: rec.userAgent,
      deviceId: deviceId ?? null,
    });
    await this.db.appendAudit({ businessId, actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, requestId: meta.requestId });
    return { token: rec.token, csrfToken: issueCsrfToken(), userId: user.id, businessId };
  }

  async logout(tokenHash: string, requestId: string): Promise<void> {
    const session = await this.db.findSessionByTokenHash(tokenHash);
    if (!session) return;
    await this.db.revokeSession(session.id);
    await this.db.appendAudit({ businessId: session.businessId, actorId: session.userId, action: "auth.logout", entityType: "Session", entityId: session.id, requestId });
  }

  async requestReset(email: string, meta: { requestId: string; ip: string | null }): Promise<{ tokenForTest?: string }> {
    const user = await this.db.findUserByEmail(email);
    if (!user) return {};
    const rec = createResetToken({ userId: user.id, requestId: meta.requestId, ip: meta.ip });
    await this.db.saveResetToken({ userId: rec.userId, tokenHash: rec.tokenHash, expiresAt: rec.expiresAt, usedAt: null, requestId: rec.requestId, ip: rec.ip });
    return { tokenForTest: rec.token };
  }

  async confirmReset(token: string, newPassword: string, requestId: string): Promise<void> {
    const tokenHash = hashToken(token);
    const stored = await this.db.findResetToken(tokenHash);
    if (!stored) throw new Error("AUTH_TOKEN_INVALID");
    try {
      consumeResetToken({ ...stored, createdAt: new Date(0), requestId: stored.requestId, ip: stored.ip }, new Date());
    } catch (e) {
      throw e;
    }
    await this.db.updateUserPassword(stored.userId, await hashPassword(newPassword));
    await this.db.markResetTokenUsed(tokenHash, new Date());
    await this.db.revokeAllUserSessions(stored.userId);
  }

  async switchBusiness(userId: string, businessId: string, sessionId: string, requestId: string): Promise<void> {
    const memberships = await this.db.listMembershipsByUser(userId);
    resolveActiveBusiness(memberships.map((m) => m.businessId), businessId);
    // FR-TENANT-02: the active business is explicit in session context, so
    // the choice is persisted on the session, not merely audited.
    await this.db.updateSession(sessionId, { activeBusinessId: businessId });
    await this.db.appendAudit({ businessId, actorId: userId, action: "auth.switch-business", entityType: "Session", entityId: sessionId, requestId });
  }

  async listSessions(userId: string): Promise<
    Array<{ id: string; businessId: string; expiresAt: Date }>
  > {
    const sessions = await this.db.listSessionsByUser(userId);
    return sessions.map((s) => ({ id: s.id, businessId: s.businessId, expiresAt: s.expiresAt }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const sessions = await this.db.listSessionsByUser(userId);
    if (!sessions.some((s) => s.id === sessionId)) return false;
    await this.db.revokeSession(sessionId);
    return true;
  }

  async checkPassword(userId: string, plain: string): Promise<boolean> {
    const user = await this.db.findUserById(userId);
    if (!user) return false;
    return verifyPassword(user.passwordHash, plain);
  }

  rolePermissions(role: string): string[] {
    return ROLE_SEED[role as keyof typeof ROLE_SEED] ?? [];
  }

  checkReAuth(authenticatedAt: Date): void {
    if (!isReAuthFresh(authenticatedAt)) throw new Error("AUTH_REAUTH_REQUIRED");
  }
}

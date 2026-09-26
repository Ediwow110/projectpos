import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "../password";
import { buildSessionRecord, hashToken, isReAuthFresh } from "../sessions";
import { consumeResetToken, createResetToken } from "../reset-tokens";
import { issueCsrfToken } from "../csrf";
import { incrementMetric } from "../../common/metrics";
import { billingEnabled } from "../../billing/entitlements";
import { buildRegistrationSeed, resolveActiveBusiness, ROLE_SEED } from "../../tenant/seed";
import type { DbPort } from "../../common/db.port";
import {
  NOOP_TRANSACTIONAL_EMAIL,
  type TransactionalEmailPort,
} from "../../email/email.service";

@Injectable()
export class AuthService {
  constructor(
    @Inject("DbPort") private readonly db: DbPort,
    private readonly email: TransactionalEmailPort = NOOP_TRANSACTIONAL_EMAIL,
  ) {}

  async register(input: { ownerName: string; email: string; password: string; businessName: string }, meta: { requestId: string; ip: string | null; userAgent: string | null }): Promise<{ user: { id: string; email: string; name: string }; business: { id: string; name: string; currency: string }; token: string; csrfToken: string; verificationRequired: boolean; verificationToken?: string }> {
    const existing = await this.db.findUserByEmail(input.email);
    if (existing) throw new Error("AUTH_EMAIL_TAKEN");
    const seed = await buildRegistrationSeed(input);
    // FR-AUTH-01: email verification is opt-in at the instance level. The
    // initial owner is created unverified under the flag and receives a
    // single-use token at the service boundary. HTTP never exposes it; a
    // production mailer is still required to deliver it to the owner.
    const requireEmailVerification = process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"] === "1";
    const user = await this.db.createUser({
      name: seed.user.name, email: seed.user.email, passwordHash: seed.user.passwordHash,
      emailVerified: !requireEmailVerification,
    });
    let verificationToken: string | undefined;
    if (requireEmailVerification) {
      verificationToken = randomBytes(16).toString("hex");
      await this.db.createEmailVerificationToken({
        userId: user.id,
        tokenHash: hashToken(verificationToken),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });
    }
    const business = await this.db.createBusiness({ name: seed.business.name, currency: seed.business.currency });
    for (const [roleName, permissions] of Object.entries(seed.roles)) {
      void roleName;
      void permissions;
    }
    await this.db.createMembership({ businessId: business.id, userId: user.id, role: seed.ownerRoleName });
    const settings: Record<string, unknown> = { currency: seed.business.currency, onboarding: seed.onboarding };
    for (const entry of seed.defaultSettings) settings[entry.key] = entry.value;
    await this.db.saveSettings(business.id, settings);
    if (billingEnabled()) {
      // Billing is opt-in. Tests keep the subscription lifecycle covered, but
      // normal development/production instances run with unrestricted
      // Enterprise-equivalent entitlements until BILLING_ENABLED=1.
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
    }
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
    if (verificationToken) {
      try {
        await this.email.sendEmailVerification({
          to: user.email,
          name: user.name,
          token: verificationToken,
        });
        await this.db.appendAudit({
          businessId: business.id,
          actorId: user.id,
          action: "auth.email-verification.sent",
          entityType: "User",
          entityId: user.id,
          requestId: meta.requestId,
        });
      } catch {
        await this.db.appendAudit({
          businessId: business.id,
          actorId: user.id,
          action: "auth.email-verification.delivery-failed",
          entityType: "User",
          entityId: user.id,
          requestId: meta.requestId,
        });
      }
    }
    return {
      user: { id: user.id, email: user.email, name: user.name },
      business: { id: business.id, name: business.name, currency: business.currency },
      token: rec.token,
      csrfToken: issueCsrfToken(),
      verificationRequired: requireEmailVerification,
      ...(verificationToken ? { verificationToken } : {}),
    };
  }

  // FR-AUTH-01: single-use redemption flips the account to verified and
  // lifts the login gate.
  async verifyEmail(token: string): Promise<{ verified: true }> {
    const stored = await this.db.findEmailVerificationToken(hashToken(token));
    if (!stored || stored.usedAt !== null || stored.expiresAt.getTime() <= Date.now()) {
      throw new Error("VALIDATION");
    }
    await this.db.markEmailVerificationTokenUsed(stored.id);
    await this.db.setUserEmailVerified(stored.userId, true);
    await this.db.appendAudit({
      businessId: null, actorId: stored.userId, action: "email.verified",
      entityType: "User", entityId: stored.userId, requestId: "verify-email",
    });
    return { verified: true };
  }

  async login(input: { email: string; password: string }, meta: { requestId: string; ip: string | null; userAgent: string | null }, deviceId?: string): Promise<{ token: string; csrfToken: string; userId: string; businessId: string }> {
    const user = await this.db.findUserByEmail(input.email);
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      incrementMetric("pos_auth_failures_total");
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }
    // FR-AUTH-01: when email verification is enabled at the instance level,
    // an unverified account cannot sign in until its token is redeemed.
    if (user.emailVerified === false) throw new Error("EMAIL_UNVERIFIED");
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
    try {
      await this.email.sendPasswordReset({ to: user.email, name: user.name, token: rec.token });
      await this.db.appendAudit({
        businessId: null,
        actorId: user.id,
        action: "auth.password-reset.sent",
        entityType: "User",
        entityId: user.id,
        requestId: meta.requestId,
      });
    } catch {
      await this.db.appendAudit({
        businessId: null,
        actorId: user.id,
        action: "auth.password-reset.delivery-failed",
        entityType: "User",
        entityId: user.id,
        requestId: meta.requestId,
      });
    }
    return { tokenForTest: rec.token };
  }

  async resendVerification(email: string, meta: { requestId: string; ip: string | null }): Promise<void> {
    void meta.ip;
    const user = await this.db.findUserByEmail(email);
    if (!user || user.emailVerified) return;
    const token = randomBytes(16).toString("hex");
    await this.db.createEmailVerificationToken({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
    try {
      await this.email.sendEmailVerification({ to: user.email, name: user.name, token });
      await this.db.appendAudit({
        businessId: null,
        actorId: user.id,
        action: "auth.email-verification.resent",
        entityType: "User",
        entityId: user.id,
        requestId: meta.requestId,
      });
    } catch {
      await this.db.appendAudit({
        businessId: null,
        actorId: user.id,
        action: "auth.email-verification.delivery-failed",
        entityType: "User",
        entityId: user.id,
        requestId: meta.requestId,
      });
    }
  }

  async confirmReset(token: string, newPassword: string, requestId: string): Promise<void> {
    const tokenHash = hashToken(token);
    const passwordHash = await hashPassword(newPassword);
    await this.db.withLock(`password-reset:${tokenHash}`, async () => {
      const stored = await this.db.findResetToken(tokenHash);
      if (!stored) throw new Error("AUTH_TOKEN_INVALID");
      consumeResetToken(
        { ...stored, createdAt: new Date(0), requestId: stored.requestId, ip: stored.ip },
        new Date(),
      );
      await this.db.updateUserPassword(stored.userId, passwordHash);
      await this.db.markResetTokenUsed(tokenHash, new Date());
      await this.db.revokeAllUserSessions(stored.userId);
    });
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

  async confirmPassword(userId: string, sessionId: string, plain: string): Promise<boolean> {
    if (!(await this.checkPassword(userId, plain))) return false;
    await this.db.updateSession(sessionId, { authenticatedAt: new Date() });
    return true;
  }

  rolePermissions(role: string): string[] {
    return ROLE_SEED[role as keyof typeof ROLE_SEED] ?? [];
  }

  checkReAuth(authenticatedAt: Date): void {
    if (!isReAuthFresh(authenticatedAt)) throw new Error("AUTH_REAUTH_REQUIRED");
  }
}

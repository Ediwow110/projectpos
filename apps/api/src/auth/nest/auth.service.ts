import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { verifyApprovalPin } from "../approval-pin";
import { hashPassword, verifyPassword } from "../password";
import { buildSessionRecord, hashToken, isReAuthFresh } from "../sessions";
import { consumeResetToken, createResetToken } from "../reset-tokens";
import { issueCsrfToken } from "../csrf";
import { incrementMetric } from "../../common/metrics";
import { billingEnabled } from "../../billing/entitlements";
import { buildRegistrationSeed, resolveActiveBusiness, ROLE_SEED } from "../../tenant/seed";
import { effectivePermissions } from "../member-permissions";
import { configuredOnboardingState, isOnboardingComplete } from "../../business/onboarding";
import type { DbPort } from "../../common/db.port";
import {
  NOOP_TRANSACTIONAL_EMAIL,
  type TransactionalEmailPort,
} from "../../email/email.service";

// Timing equalization, not a credential: these are throwaway argon2 digests of
// values no account uses, produced with the same parameters as hashPassword()
// and hashApprovalPin(). A path that answers without touching argon2 is
// measurably faster than one that verifies, which lets an attacker enumerate
// accounts (or managers with no PIN enrolled) before guessing anything. The miss
// paths verify against these so every credential answer costs the same.
const TIMING_EQUALIZATION_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$lpDM38Ji/4uSRGE570/4EQ$pzhkZZuZmEus28wzBgrznJBXH4UKZ9/Sncseo7dTWMA";
const TIMING_EQUALIZATION_APPROVAL_PIN_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$7H+zBDO0RHOtOLJsu8WVjA$+KnEhxZG8llW2jRwc9mAmns+821wzNGWAA280qS7ino";

// The caller-scoped limiter (5/min per till, see sales.controller.shared.ts)
// cannot protect a manager's six-digit approval PIN: every till gets its own
// budget, N cashiers aggregate against one credential, and the manager being
// guessed at never trips. Misses are therefore counted against the credential
// being verified, and the fifth miss inside the window locks that approver's
// credential out with a doubling backoff.
const APPROVER_MISS_WINDOW_MS = 60_000;
const APPROVER_MISS_LIMIT = 5;
const APPROVER_LOCKOUT_MS = 60_000;
const APPROVER_LOCKOUT_MAX_MS = 15 * 60_000;
const APPROVER_TRACKED_KEYS_MAX = 10_000;

interface ApproverCredentialState {
  count: number;
  lastMissAt: number;
  lockedUntil: number;
  lockouts: number;
}

const approverCredentialStates = new Map<string, ApproverCredentialState>();

// Keyed on the approver being verified, never on the caller.
export function approverCredentialKey(businessId: string, email: string): string {
  return `${businessId}:approval-credential:${email.trim().toLowerCase()}`;
}

export function assertApproverCredentialAvailable(key: string, now: number = Date.now()): void {
  const state = approverCredentialStates.get(key);
  if (state && state.lockedUntil > now) throw new Error("RATE_LIMITED");
}

export function recordApproverCredentialMiss(key: string, now: number = Date.now()): void {
  let state = approverCredentialStates.get(key);
  if (!state) {
    // Unbounded tracked keys would make the brake itself a memory DoS.
    if (approverCredentialStates.size >= APPROVER_TRACKED_KEYS_MAX) {
      for (const [tracked, entry] of approverCredentialStates) {
        if (entry.lockedUntil <= now && now - entry.lastMissAt > APPROVER_MISS_WINDOW_MS) approverCredentialStates.delete(tracked);
      }
    }
    state = { count: 0, lastMissAt: 0, lockedUntil: 0, lockouts: 0 };
    approverCredentialStates.set(key, state);
  }
  state.count = now - state.lastMissAt > APPROVER_MISS_WINDOW_MS ? 1 : state.count + 1;
  state.lastMissAt = now;
  incrementMetric("pos_approval_credential_failures_total");
  if (state.count < APPROVER_MISS_LIMIT) return;
  state.lockouts += 1;
  state.lockedUntil = now + Math.min(APPROVER_LOCKOUT_MS * 2 ** (state.lockouts - 1), APPROVER_LOCKOUT_MAX_MS);
  state.count = 0;
  incrementMetric("pos_approval_credential_lockouts_total");
}

export function clearApproverCredentialMisses(key: string): void {
  approverCredentialStates.delete(key);
}

export function resetApproverCredentialThrottleForTests(): void {
  approverCredentialStates.clear();
}

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
    const provisioned = await this.db.withTransaction(async (db) => {
      // Re-check inside the transaction so concurrent attempts do not proceed
      // through the rest of account provisioning after the initial fast-path
      // lookup above.
      const concurrentExisting = await db.findUserByEmail(input.email);
      if (concurrentExisting) throw new Error("AUTH_EMAIL_TAKEN");

      const user = await db.createUser({
        name: seed.user.name, email: seed.user.email, passwordHash: seed.user.passwordHash,
        emailVerified: !requireEmailVerification,
      });
      let verificationToken: string | undefined;
      if (requireEmailVerification) {
        verificationToken = randomBytes(16).toString("hex");
        await db.createEmailVerificationToken({
          userId: user.id,
          tokenHash: hashToken(verificationToken),
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        });
      }
      const business = await db.createBusiness({ name: seed.business.name, currency: seed.business.currency });
      for (const [roleName, permissions] of Object.entries(seed.roles)) {
        void roleName;
        void permissions;
      }
      await db.createMembership({ businessId: business.id, userId: user.id, role: seed.ownerRoleName });
      const settings: Record<string, unknown> = { currency: seed.business.currency, onboarding: seed.onboarding };
      for (const entry of seed.defaultSettings) settings[entry.key] = entry.value;
      await db.saveSettings(business.id, settings);
      if (billingEnabled()) {
        // Billing is opt-in. Tests keep the subscription lifecycle covered, but
        // normal development/production instances run with unrestricted
        // Enterprise-equivalent entitlements until BILLING_ENABLED=1.
        const pro = await db.findPlanByKey("pro");
        const trialEndsAt = new Date(Date.now() + 14 * 86400000);
        const sub = await db.upsertSubscription({
          businessId: business.id,
          planId: pro!.id,
          status: "trialing",
          trialEndsAt,
          currentPeriodEnd: trialEndsAt,
        });
        await db.appendAudit({ businessId: business.id, actorId: user.id, action: "subscription.created", entityType: "Subscription", entityId: sub.id, requestId: meta.requestId });
      }
      const rec = buildSessionRecord({ userId: user.id, businessId: business.id, ip: meta.ip, userAgent: meta.userAgent });
      await db.createSession({
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
      await db.appendAudit({ businessId: business.id, actorId: user.id, action: "auth.register", entityType: "User", entityId: user.id, requestId: meta.requestId });
      await db.appendAudit({ businessId: business.id, actorId: user.id, action: "business.create", entityType: "Business", entityId: business.id, requestId: meta.requestId });
      return { user, business, rec, verificationToken };
    });
    const { user, business, rec, verificationToken } = provisioned;
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
    const tokenHash = hashToken(token);
    return this.db.withLock(`email-verification:${tokenHash}`, async () => {
      const stored = await this.db.findEmailVerificationToken(tokenHash);
      if (!stored || stored.usedAt !== null || stored.expiresAt.getTime() <= Date.now()) {
        throw new Error("VALIDATION");
      }
      await this.db.markEmailVerificationTokenUsed(stored.id);
      await this.db.setUserEmailVerified(stored.userId, true);
      // Registration creates a provisional session so the verification gate
      // can be exercised consistently. Do not silently promote that session
      // into an authenticated one after email redemption; require a fresh
      // credentialed login instead.
      await this.db.revokeAllUserSessions(stored.userId);
      await this.db.appendAudit({
        businessId: null, actorId: stored.userId, action: "email.verified",
        entityType: "User", entityId: stored.userId, requestId: "verify-email",
      });
      return { verified: true };
    });
  }

  async login(input: { email: string; password: string }, meta: { requestId: string; ip: string | null; userAgent: string | null }, deviceId?: string): Promise<{ token: string; csrfToken: string; userId: string; businessId: string; onboardingRequired: boolean }> {
    const user = await this.db.findUserByEmail(input.email);
    // An unknown address still pays a full argon2 verify: skipping it would make
    // "no such account" answer faster than "wrong password" and turn the login
    // endpoint into an account enumerator.
    const passwordMatches = await verifyPassword(user?.passwordHash ?? TIMING_EQUALIZATION_PASSWORD_HASH, input.password);
    if (!user || !passwordMatches) {
      incrementMetric("pos_auth_failures_total");
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }
    // FR-AUTH-01: when email verification is enabled at the instance level,
    // an unverified account cannot sign in until its token is redeemed.
    if (user.emailVerified === false) throw new Error("EMAIL_UNVERIFIED");
    const memberships = await this.db.listMembershipsByUser(user.id);
    if (memberships.length === 0) throw new Error("TENANT_REQUIRED");
    const membership = memberships[0];
    const businessId = membership.businessId;
    if (deviceId !== undefined) {
      const device = await this.db.findDeviceById(deviceId, businessId);
      if (!device || device.userId !== user.id || device.revokedAt !== null) {
        throw new Error("FORBIDDEN");
      }
    }
    const settings = await this.db.getSettings(businessId);
    const onboarding = configuredOnboardingState(settings);
    const rec = buildSessionRecord({ userId: user.id, businessId, ip: meta.ip, userAgent: meta.userAgent });
    await this.db.createSession({
      userId: rec.userId,
      businessId: rec.businessId,
      tokenHash: rec.tokenHash,
      expiresAt: rec.expiresAt,
      revokedAt: null,
      authenticatedAt: rec.createdAt,
      activeBranchId: null,
      ip: rec.ip,
      userAgent: rec.userAgent,
      deviceId: deviceId ?? null,
    });
    await this.db.appendAudit({ businessId, actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, requestId: meta.requestId });
    return {
      token: rec.token,
      csrfToken: issueCsrfToken(),
      userId: user.id,
      businessId,
      onboardingRequired: membership.role === "owner" && !isOnboardingComplete(onboarding),
    };
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

  async confirmReset(token: string, newPassword: string, _requestId: string): Promise<void> {
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
    await this.db.updateSession(sessionId, { activeBusinessId: businessId, activeBranchId: null });
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

  async mintManagerApproval(
    businessId: string,
    requesterId: string,
    requestId: string,
    input: { email: string; password?: string; pin?: string; permission: string; fingerprint: string; requireDistinctApprover?: boolean },
  ): Promise<{ token: string; expiresAt: Date; approver: { id: string; name: string; role: string } }> {
    const credentialKey = approverCredentialKey(businessId, input.email);
    // A locked credential is refused before the verify, whatever the calling
    // till's own budget says, so the brake follows the credential under attack.
    assertApproverCredentialAvailable(credentialKey);
    const approver = await this.db.findUserByEmail(input.email.trim().toLowerCase());
    const membership = approver ? await this.db.findMembership(approver.id, businessId) : null;
    const eligibleRole = membership?.role === "owner" || membership?.role === "manager";
    const eligiblePermission = membership ? (
      effectivePermissions(membership.role, membership.id, await this.db.getSettings(businessId)).includes(input.permission)
    ) : false;
    // Same equalization on the approver surface: an unknown email, a missing
    // membership, or a manager with no PIN enrolled must cost what a wrong
    // credential costs, or the response time reports which staff can approve
    // before any PIN is guessed.
    const credentialValid = input.pin !== undefined
      ? await verifyApprovalPin(membership?.approvalPinHash ?? TIMING_EQUALIZATION_APPROVAL_PIN_HASH, input.pin)
      : input.password !== undefined
        ? await verifyPassword(approver?.passwordHash ?? TIMING_EQUALIZATION_PASSWORD_HASH, input.password)
        : false;
    if (input.pin !== undefined || input.password !== undefined) {
      if (credentialValid) clearApproverCredentialMisses(credentialKey);
      else recordApproverCredentialMiss(credentialKey);
    }
    const valid =
      approver !== null &&
      membership !== null &&
      membership.deactivatedAt == null &&
      approver.emailVerified !== false &&
      approver.id !== requesterId &&
      eligibleRole &&
      eligiblePermission &&
      credentialValid;
    if (!valid || !approver || !membership || (input.requireDistinctApprover && approver.id === requesterId)) {
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }

    const token = `mgr_${randomBytes(24).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
    const grant = await this.db.createManagerApprovalGrant({
      businessId,
      requesterId,
      approverId: approver.id,
      permission: input.permission,
      fingerprint: input.fingerprint,
      tokenHash: hashToken(token),
      expiresAt,
    });
    await this.db.appendAudit({
      businessId,
      actorId: approver.id,
      action: "manager.approval.granted",
      entityType: "ManagerApprovalGrant",
      entityId: grant.id,
      requestId,
      reason: input.permission,
      after: { requesterId },
    });
    return {
      token,
      expiresAt,
      approver: { id: approver.id, name: approver.name, role: membership.role },
    };
  }

  async consumeManagerApproval(
    businessId: string,
    requesterId: string,
    permission: string,
    fingerprint: string,
    token: string,
    requireDistinctApprover = false,
  ): Promise<{ approverId: string; approverName: string; approverRole: string }> {
    const tokenHash = hashToken(token);
    return this.db.withLock(`manager-approval:${tokenHash}`, async () => {
      const grant = await this.db.findValidManagerApprovalGrant(tokenHash, businessId, requesterId, permission);
      if (!grant || grant.fingerprint !== fingerprint) throw new Error("FORBIDDEN");
      const approver = await this.db.findUserById(grant.approverId);
      const membership = approver ? await this.db.findMembership(approver.id, businessId) : null;
      if (
        !approver ||
        !membership ||
        membership.deactivatedAt != null ||
        (membership.role !== "owner" && membership.role !== "manager") ||
        !effectivePermissions(membership.role, membership.id, await this.db.getSettings(businessId)).includes(permission) ||
        (requireDistinctApprover && approver.id === requesterId)
      ) throw new Error("FORBIDDEN");
      await this.db.markManagerApprovalGrantUsed(grant.id);
      return { approverId: approver.id, approverName: approver.name, approverRole: membership.role };
    });
  }

  rolePermissions(role: string): string[] {
    return ROLE_SEED[role as keyof typeof ROLE_SEED] ?? [];
  }

  permissionsForRequest(auth: { role: string; effectivePermissions?: string[] }): string[] {
    // Staff sessions set this on every request in SessionGuard. The fallback
    // retains compatibility with API-token and direct-controller test paths.
    return auth.effectivePermissions ?? this.rolePermissions(auth.role);
  }

  checkReAuth(authenticatedAt: Date): void {
    if (!isReAuthFresh(authenticatedAt)) throw new Error("AUTH_REAUTH_REQUIRED");
  }
}

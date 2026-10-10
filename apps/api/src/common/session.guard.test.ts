import { describe, expect, it } from "vitest";
import { createMemoryDb } from "./memory.db";
import { SessionGuard } from "./session.guard";
import { hashToken } from "../auth/sessions";
import { defaultOnboardingState, applyOnboardingPatch } from "../business/onboarding";

async function completeRequiredSetup(db: ReturnType<typeof createMemoryDb>, businessId: string): Promise<void> {
  let onboarding = defaultOnboardingState();
  onboarding = applyOnboardingPatch(onboarding, { step: "taxCurrency", state: "done" });
  onboarding = applyOnboardingPatch(onboarding, { step: "receiptSetup", state: "done" });
  await db.saveSettings(businessId, { ...(await db.getSettings(businessId)), onboarding });
}

describe("SessionGuard effective role assignments", () => {
  it("uses the active role union while preserving a primary legacy role", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Role Union", currency: "PHP" });
    await completeRequiredSetup(db, business.id);
    const user = await db.createUser({ name: "Maria", email: "maria-role-union@example.com", passwordHash: "unused" });
    const membership = await db.createMembership({ businessId: business.id, userId: user.id, role: "cashier" });
    const now = new Date("2026-01-01T00:00:00.000Z");
    await db.createRoleAssignment({
      businessId: business.id,
      membershipId: membership.id,
      role: "cashier",
      assignmentType: "PERMANENT",
      branchId: null,
      startsAt: new Date("2025-01-01T00:00:00.000Z"),
      expiresAt: null,
      assignedBy: user.id,
      assignedAt: new Date("2025-01-01T00:00:00.000Z"),
      assignmentReason: "seed",
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
      idempotencyKey: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.createRoleAssignment({
      businessId: business.id,
      membershipId: membership.id,
      role: "inventory",
      assignmentType: "TEMPORARY",
      branchId: null,
      startsAt: new Date("2025-01-01T00:00:00.000Z"),
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      assignedBy: user.id,
      assignedAt: new Date("2025-01-01T00:00:00.000Z"),
      assignmentReason: "stock count coverage",
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
      idempotencyKey: null,
      createdAt: now,
      updatedAt: now,
    });
    const session = await db.createSession({
      userId: user.id,
      businessId: business.id,
      tokenHash: hashToken("role-union-session"),
      expiresAt: new Date("2027-01-03T00:00:00.000Z"),
      revokedAt: null,
      authenticatedAt: new Date("2025-01-01T00:00:00.000Z"),
      ip: null,
      userAgent: null,
    });
    const req: { cookies: Record<string, string>; auth?: any; rolePermissions?: string[] } = { cookies: { pos_session: "role-union-session" } };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as never;
    expect(await new SessionGuard(db).canActivate(context)).toBe(true);
    expect(req.auth.roles).toEqual(["cashier", "inventory"]);
    expect(req.auth.role).toBe("cashier");
    expect(req.rolePermissions).toContain("inventory.adjust");
    expect(session.id).toBeTruthy();
  });

  it("does not resurrect a normalized role after its assignment expires", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Expired Role", currency: "PHP" });
    await completeRequiredSetup(db, business.id);
    const user = await db.createUser({ name: "Maria", email: "maria-expired@example.com", passwordHash: "unused" });
    const membership = await db.createMembership({ businessId: business.id, userId: user.id, role: "manager" });
    await db.createRoleAssignment({ businessId: business.id, membershipId: membership.id, role: "manager", assignmentType: "TEMPORARY", branchId: null, startsAt: new Date("2025-01-01T00:00:00.000Z"), expiresAt: new Date("2025-02-01T00:00:00.000Z"), assignedBy: user.id, assignedAt: new Date("2025-01-01T00:00:00.000Z"), assignmentReason: "expired", revokedAt: null, revokedBy: null, revocationReason: null, idempotencyKey: null, createdAt: new Date(), updatedAt: new Date() });
    await db.createSession({ userId: user.id, businessId: business.id, tokenHash: hashToken("expired-role-session"), expiresAt: new Date("2027-01-01T00:00:00.000Z"), revokedAt: null, authenticatedAt: new Date(), ip: null, userAgent: null });
    const req: { cookies: Record<string, string>; auth?: any; rolePermissions?: string[] } = { cookies: { pos_session: "expired-role-session" } };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as never;
    expect(await new SessionGuard(db).canActivate(context)).toBe(true);
    expect(req.auth.role).toBe("none");
    expect(req.auth.roles).toEqual([]);
    expect(req.rolePermissions).toEqual([]);
  });
});

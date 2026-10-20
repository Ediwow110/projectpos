import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { createMemoryDb } from "../common/memory.db";
import { SessionGuard } from "../common/session.guard";
import { AuthService } from "./nest/auth.service";
import { hashToken } from "./sessions";
import { MEMBER_DENIALS_KEY } from "./member-permissions";

describe("session permission restrictions", () => {
  it.each([
    { label: "expired", expiresAt: new Date(Date.now() - 60_000), revokedAt: null },
    { label: "revoked", expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
  ])("rejects a $label session before granting permissions", async ({ label, expiresAt, revokedAt }) => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Guard business", currency: "PHP" });
    const user = await db.createUser({ name: "Stock", email: `guard-${label}@example.com`, passwordHash: "unused" });
    const token = `sample-${label}-session-token`;
    await db.createSession({
      userId: user.id,
      businessId: business.id,
      tokenHash: hashToken(token),
      expiresAt,
      revokedAt,
      authenticatedAt: new Date(),
      ip: null,
      userAgent: null,
    });
    const request: Record<string, unknown> = {
      cookies: { pos_session: token },
      method: "GET",
      path: "/api/v1/me",
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    const guard = new SessionGuard(db);

    expect(await guard.canActivate(context)).toBe(false);
    expect(request["authError"]).toBe(label === "expired" ? "SESSION_EXPIRED" : "SESSION_REVOKED");
    expect(request["auth"]).toBeUndefined();
  });

  it("recalculates an employee's effective grants on every authenticated request", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Guard business", currency: "PHP" });
    const user = await db.createUser({ name: "Stock", email: "guard-stock@example.com", passwordHash: "unused" });
    const membership = await db.createMembership({ businessId: business.id, userId: user.id, role: "inventory" });
    const token = "sample-test-session-token";
    await db.createSession({
      userId: user.id,
      businessId: business.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
      authenticatedAt: new Date(),
      ip: null,
      userAgent: null,
    });
    const request: Record<string, unknown> = {
      cookies: { pos_session: token },
      method: "GET",
      path: "/api/v1/me",
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    const guard = new SessionGuard(db);
    const auth = new AuthService(db);
    expect(await guard.canActivate(context)).toBe(true);
    expect(auth.permissionsForRequest(request.auth as { role: string; effectivePermissions?: string[] })).toContain("cost.view");
    await db.saveSettings(business.id, {
      [MEMBER_DENIALS_KEY]: { [membership.id]: ["cost.view", "price.edit"] },
    });
    expect(await guard.canActivate(context)).toBe(true);
    const grants = auth.permissionsForRequest(request.auth as { role: string; effectivePermissions?: string[] });
    expect(grants).not.toContain("cost.view");
    expect(grants).not.toContain("price.edit");
    expect(grants).toContain("inventory.adjust");
  });
});

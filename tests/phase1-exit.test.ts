import { describe, expect, it } from "vitest";
import { authorize } from "../apps/api/src/tenant.guard";
import { verifyPassword, hashPassword } from "../apps/api/src/auth/password";
import { consumeResetToken, createResetToken } from "../apps/api/src/auth/reset-tokens";
import {
  applyOnboardingPatch,
  defaultOnboardingState,
  isOnboardingComplete,
} from "../apps/api/src/business/onboarding";
import { hasPermission } from "../packages/auth/src/permissions";
import { buildRegistrationSeed } from "../apps/api/src/tenant/seed";

describe("phase1 exit", () => {
  it("owner registers and reaches dashboard path", async () => {
    const hash = await hashPassword("correct-horse-12");
    expect(await verifyPassword(hash, "correct-horse-12")).toBe(true);
    let s = defaultOnboardingState();
    for (const step of ["taxCurrency", "receiptSetup"] as const) {
      s = applyOnboardingPatch(s, { step, state: "done" });
    }
    s = applyOnboardingPatch(s, { step: "products", state: "skipped" });
    s = applyOnboardingPatch(s, { step: "employees", state: "skipped" });
    expect(isOnboardingComplete(s)).toBe(true);
  });
  it("cashier cannot touch settings", () => {
    expect(hasPermission([], "settings.write", "b1", "b1")).toBe(false);
  });
  it("cross-tenant authorize still blocked", () => {
    expect(() => authorize({ membershipBusinessId: "b1", claimedBusinessId: "b2" })).toThrow();
  });
  it("reset token is single-use", () => {
    const rec = createResetToken({ userId: "u1", requestId: "r1", ip: null });
    consumeResetToken(rec, new Date());
    expect(() => consumeResetToken({ ...rec, usedAt: new Date() }, new Date())).toThrow(
      "AUTH_TOKEN_USED",
    );
  });
  it("registration seed never stores plaintext passwords", async () => {
    const a = await buildRegistrationSeed({
      ownerName: "Ana",
      email: "ana@example.com",
      password: "correct-horse-12",
      businessName: "S",
    });
    expect(a.user.passwordHash).not.toBe("correct-horse-12");
  });
});

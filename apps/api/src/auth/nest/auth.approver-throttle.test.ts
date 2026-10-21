import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { hashApprovalPin } from "../approval-pin";
import { hashPassword } from "../password";
import { AuthService, resetApproverCredentialThrottleForTests } from "./auth.service";

vi.mock("../approval-pin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../approval-pin")>();
  return { ...actual, verifyApprovalPin: vi.fn(actual.verifyApprovalPin) };
});

import { verifyApprovalPin } from "../approval-pin";

const PIN = "482615";
const WRONG_PIN = "111111";

async function fixture() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Throttle Store", currency: "PHP" });
  async function manager(email: string) {
    const user = await db.createUser({ name: "Manager", email, passwordHash: await hashPassword("manager-password-12"), emailVerified: true });
    const membership = await db.createMembership({ businessId: business.id, userId: user.id, role: "manager" });
    await db.updateMembership(membership.id, business.id, { approvalPinHash: await hashApprovalPin(PIN) });
    return user;
  }
  return { db, business, first: await manager("throttle-a@example.com"), second: await manager("throttle-b@example.com"), auth: new AuthService(db) };
}

function attempt(email: string, pin: string) {
  return { email, pin, permission: "discount.override", fingerprint: "cart" };
}

describe("per-approver credential throttle", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetApproverCredentialThrottleForTests();
  });

  // The caller-scoped limiter (5/min per cashier) cannot protect a six-digit
  // manager PIN: every till gets its own budget, N cashiers aggregate against one
  // credential, and the manager whose PIN is being guessed never trips.
  it("locks the credential after five misses collected across different callers", async () => {
    const { auth, business, first } = await fixture();
    for (let caller = 0; caller < 5; caller += 1) {
      await expect(auth.mintManagerApproval(business.id, `cashier-${caller}`, `req-${caller}`, attempt(first.email, WRONG_PIN)))
        .rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    }
    await expect(auth.mintManagerApproval(business.id, "cashier-99", "req-locked", attempt(first.email, PIN)))
      .rejects.toThrow("RATE_LIMITED");
    // The locked attempt never reaches argon2: the credential is out, whatever
    // the caller's own budget says.
    expect(vi.mocked(verifyApprovalPin)).toHaveBeenCalledTimes(5);
  });

  it("keys the lockout on the approver being verified, not on the caller or the whole business", async () => {
    const { auth, business, first, second } = await fixture();
    for (let caller = 0; caller < 5; caller += 1) {
      await expect(auth.mintManagerApproval(business.id, `cashier-${caller}`, `miss-${caller}`, attempt(first.email, WRONG_PIN)))
        .rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    }
    const untouched = await auth.mintManagerApproval(business.id, "cashier-0", "other-approver", attempt(second.email, PIN));
    expect(untouched.approver.id).toBe(second.id);
    await expect(auth.mintManagerApproval(business.id, "cashier-1", "same-approver", attempt(first.email, PIN)))
      .rejects.toThrow("RATE_LIMITED");
  });

  it("clears the accumulated misses when the credential verifies", async () => {
    const { auth, business, first } = await fixture();
    for (let caller = 0; caller < 4; caller += 1) {
      await expect(auth.mintManagerApproval(business.id, `cashier-${caller}`, `miss-${caller}`, attempt(first.email, WRONG_PIN)))
        .rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    }
    const granted = await auth.mintManagerApproval(business.id, "cashier-4", "good", attempt(first.email, PIN));
    expect(granted.approver.id).toBe(first.id);
    for (let caller = 5; caller < 9; caller += 1) {
      await expect(auth.mintManagerApproval(business.id, `cashier-${caller}`, `miss-${caller}`, attempt(first.email, WRONG_PIN)))
        .rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    }
    const stillUsable = await auth.mintManagerApproval(business.id, "cashier-9", "good-again", attempt(first.email, PIN));
    expect(stillUsable.approver.id).toBe(first.id);
  });

  it("refuses again, with a longer backoff, if the locked credential keeps missing", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-21T00:00:00.000Z") });
    const { auth, business, first } = await fixture();
    for (let caller = 0; caller < 5; caller += 1) {
      await expect(auth.mintManagerApproval(business.id, `cashier-${caller}`, `miss-${caller}`, attempt(first.email, WRONG_PIN)))
        .rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    }
    vi.advanceTimersByTime(61_000);
    for (let caller = 0; caller < 5; caller += 1) {
      await expect(auth.mintManagerApproval(business.id, `repeater-${caller}`, `miss2-${caller}`, attempt(first.email, WRONG_PIN)))
        .rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    }
    // Second strike doubles the lockout: the first 60s has not bought the
    // attacker another attempt.
    vi.advanceTimersByTime(61_000);
    await expect(auth.mintManagerApproval(business.id, "cashier-late", "miss3", attempt(first.email, PIN)))
      .rejects.toThrow("RATE_LIMITED");
    vi.advanceTimersByTime(61_000);
    const recovered = await auth.mintManagerApproval(business.id, "cashier-late", "ok", attempt(first.email, PIN));
    expect(recovered.approver.id).toBe(first.id);
  });
});

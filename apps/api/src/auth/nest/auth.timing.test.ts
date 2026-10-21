import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { hashApprovalPin } from "../approval-pin";
import { hashPassword } from "../password";
import { AuthService } from "./auth.service";

vi.mock("../password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
vi.mock("../approval-pin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../approval-pin")>();
  return { ...actual, verifyApprovalPin: vi.fn(actual.verifyApprovalPin) };
});

import { verifyApprovalPin } from "../approval-pin";
import { verifyPassword } from "../password";

async function fixture() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Timing Store", currency: "PHP" });
  const manager = await db.createUser({
    name: "Manager", email: "manager-timing@example.com",
    passwordHash: await hashPassword("manager-password-12"), emailVerified: true,
  });
  const membership = await db.createMembership({ businessId: business.id, userId: manager.id, role: "manager" });
  return { db, business, manager, membership, auth: new AuthService(db) };
}

describe("credential-path timing equalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A response that returns without touching argon2 is measurably faster than a
  // failed one, so a miss that skips verification leaks which accounts exist
  // before any credential is tried. The fix is to pay the same cost either way.
  it("verifies a password-shaped cost for an unknown account on login", async () => {
    const { auth } = await fixture();
    await expect(auth.login(
      { email: "nobody@example.com", password: "correct-horse-12" },
      { requestId: "login-unknown", ip: "127.0.0.1", userAgent: "vitest" },
    )).rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
  });

  it("verifies the password cost for an approver email that does not exist", async () => {
    const { auth, business } = await fixture();
    await expect(auth.mintManagerApproval(business.id, "requester-1", "approval-unknown", {
      email: "ghost@example.com", password: "manager-password-12",
      permission: "discount.override", fingerprint: "cart-1",
    })).rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
  });

  it("verifies the PIN cost when the approver has no PIN enrolled", async () => {
    const { auth, business, manager, membership } = await fixture();
    expect(membership.approvalPinHash ?? null).toBeNull();
    await expect(auth.mintManagerApproval(business.id, "requester-1", "approval-no-pin", {
      email: manager.email, pin: "482615",
      permission: "discount.override", fingerprint: "cart-1",
    })).rejects.toThrow("AUTH_INVALID_CREDENTIALS");
    expect(vi.mocked(verifyApprovalPin)).toHaveBeenCalledTimes(1);
  });

  it("still resolves a real enrolled PIN through the same path", async () => {
    const { auth, db, business, manager, membership } = await fixture();
    await db.updateMembership(membership.id, business.id, { approvalPinHash: await hashApprovalPin("482615") });
    const minted = await auth.mintManagerApproval(business.id, "requester-1", "approval-pin-ok", {
      email: manager.email, pin: "482615",
      permission: "discount.override", fingerprint: "cart-pin",
    });
    expect(minted.approver.id).toBe(manager.id);
    expect(vi.mocked(verifyApprovalPin)).toHaveBeenCalledTimes(1);
  });
});

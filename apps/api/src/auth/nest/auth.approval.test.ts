import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../../common/memory.db";
import { hashApprovalPin } from "../approval-pin";
import { hashPassword } from "../password";
import { AuthService } from "./auth.service";

async function setupApprovers() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Approval Store", currency: "PHP" });
  const cashier = await db.createUser({
    name: "Cashier",
    email: "cashier-approval@example.com",
    passwordHash: await hashPassword("cashier-password-12"),
  });
  await db.createMembership({ businessId: business.id, userId: cashier.id, role: "cashier", deactivatedAt: null });
  const manager = await db.createUser({
    name: "Manager",
    email: "manager-approval@example.com",
    passwordHash: await hashPassword("manager-password-12"),
  });
  const managerMembership = await db.createMembership({
    businessId: business.id,
    userId: manager.id,
    role: "manager",
    deactivatedAt: null,
  });
  return { db, business, cashier, manager, managerMembership, auth: new AuthService(db) };
}

describe("manager action approvals", () => {
  it("mints and consumes one short-lived grant bound to requester, permission and fingerprint", async () => {
    const { auth, business, cashier, manager } = await setupApprovers();
    const minted = await auth.mintManagerApproval(
      business.id,
      cashier.id,
      "approval-r1",
      {
        email: manager.email,
        password: "manager-password-12",
        permission: "discount.override",
        fingerprint: "cart-fingerprint-1",
      },
    );
    expect(minted.token).toMatch(/^mgr_/);
    expect(minted.approver).toEqual({ id: manager.id, name: manager.name, role: "manager" });
    expect(minted.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const consumed = await auth.consumeManagerApproval(
      business.id,
      cashier.id,
      "discount.override",
      "cart-fingerprint-1",
      minted.token,
    );
    expect(consumed).toEqual({ approverId: manager.id, approverName: manager.name, approverRole: "manager" });
    await expect(auth.consumeManagerApproval(
      business.id,
      cashier.id,
      "discount.override",
      "cart-fingerprint-1",
      minted.token,
    )).rejects.toThrow("FORBIDDEN");
  });

  it("allows exactly one concurrent consume of the same approval grant", async () => {
    const { auth, business, cashier, manager } = await setupApprovers();
    const minted = await auth.mintManagerApproval(
      business.id,
      cashier.id,
      "approval-r-concurrent",
      {
        email: manager.email,
        password: "manager-password-12",
        permission: "discount.override",
        fingerprint: "cart-fingerprint-concurrent",
      },
    );
    const results = await Promise.allSettled([
      auth.consumeManagerApproval(
        business.id,
        cashier.id,
        "discount.override",
        "cart-fingerprint-concurrent",
        minted.token,
      ),
      auth.consumeManagerApproval(
        business.id,
        cashier.id,
        "discount.override",
        "cart-fingerprint-concurrent",
        minted.token,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects wrong credentials, non-manager roles, deactivated managers and fingerprint mismatch", async () => {
    const { auth, db, business, cashier, manager, managerMembership } = await setupApprovers();
    await expect(auth.mintManagerApproval(business.id, cashier.id, "approval-r2", {
      email: manager.email,
      password: "wrong-password",
      permission: "discount.override",
      fingerprint: "cart-fingerprint-2",
    })).rejects.toThrow("AUTH_INVALID_CREDENTIALS");

    const inventory = await db.createUser({
      name: "Inventory",
      email: "inventory-approval@example.com",
      passwordHash: await hashPassword("inventory-password-12"),
    });
    await db.createMembership({ businessId: business.id, userId: inventory.id, role: "inventory", deactivatedAt: null });
    await expect(auth.mintManagerApproval(business.id, cashier.id, "approval-r3", {
      email: inventory.email,
      password: "inventory-password-12",
      permission: "discount.override",
      fingerprint: "cart-fingerprint-2",
    })).rejects.toThrow("AUTH_INVALID_CREDENTIALS");

    await db.updateMembership(managerMembership.id, business.id, { deactivatedAt: new Date() });
    await expect(auth.mintManagerApproval(business.id, cashier.id, "approval-r4", {
      email: manager.email,
      password: "manager-password-12",
      permission: "discount.override",
      fingerprint: "cart-fingerprint-2",
    })).rejects.toThrow("AUTH_INVALID_CREDENTIALS");

    await db.updateMembership(managerMembership.id, business.id, { deactivatedAt: null });
    const minted = await auth.mintManagerApproval(business.id, cashier.id, "approval-r5", {
      email: manager.email,
      password: "manager-password-12",
      permission: "discount.override",
      fingerprint: "cart-fingerprint-2",
    });
    await expect(auth.consumeManagerApproval(
      business.id,
      cashier.id,
      "discount.override",
      "different-cart",
      minted.token,
    )).rejects.toThrow("FORBIDDEN");
  });

  it("mints the same one-use approval grant from a business-scoped staff PIN while preserving password fallback", async () => {
    const { auth, db, business, cashier, manager, managerMembership } = await setupApprovers();
    await db.updateMembership(managerMembership.id, business.id, {
      approvalPinHash: await hashApprovalPin("482615"),
    });

    const byPin = await auth.mintManagerApproval(business.id, cashier.id, "approval-pin-r1", {
      email: manager.email,
      pin: "482615",
      permission: "discount.override",
      fingerprint: "cart-pin-1",
    });
    expect(byPin.approver).toEqual({ id: manager.id, name: manager.name, role: "manager" });

    await expect(auth.mintManagerApproval(business.id, cashier.id, "approval-pin-r2", {
      email: manager.email,
      pin: "111111",
      permission: "discount.override",
      fingerprint: "cart-pin-2",
    })).rejects.toThrow("AUTH_INVALID_CREDENTIALS");

    const byPassword = await auth.mintManagerApproval(business.id, cashier.id, "approval-pin-r3", {
      email: manager.email,
      password: "manager-password-12",
      permission: "discount.override",
      fingerprint: "cart-pin-3",
    });
    expect(byPassword.token).toMatch(/^mgr_/);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createMemoryDb } from "../common/memory.db";
import { ValueController } from "./value.controller";

describe("ValueController approval fingerprints", () => {
  it("resolves a cashier loyalty grant against the customer id used by the queue", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Value Approval", currency: "PHP" });
    const customer = await db.createCustomer({
      businessId: business.id, name: "Loyal customer", phone: null, email: null, address: null, notes: null, isActive: true,
    });
    const auth = { permissionsForRequest: vi.fn().mockReturnValue([]) };
    const policy = { resolveRequirement: vi.fn().mockResolvedValue(null) };
    const controller = new ValueController(db, auth as never, policy as never);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const request = {
      auth: { businessId: business.id, userId: "cashier-1", role: "cashier" },
      headers: { "idempotency-key": "loyalty-queue-test" },
    } as unknown as Request;

    await controller.adjustLoyalty(request, response, customer.id, {
      amountMinor: 25, reason: "Service correction", approvalToken: "one-use-approval-token",
    });

    expect(policy.resolveRequirement).toHaveBeenCalledWith(business.id, "cashier-1", {
      kind: "value_adjustment", valueType: "loyalty", targetId: customer.id,
      amountDelta: 25, reason: "Service correction",
    });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(await db.findLoyaltyAccount(customer.id, business.id)).toBeNull();
  });

  it("does not create a store-credit account for a denied cashier adjustment", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Credit Approval", currency: "PHP" });
    const customer = await db.createCustomer({ businessId: business.id, name: "New credit customer",
      phone: null, email: null, address: null, notes: null, isActive: true });
    const auth = { permissionsForRequest: vi.fn().mockReturnValue([]) };
    const policy = { resolveRequirement: vi.fn().mockResolvedValue(null) };
    const controller = new ValueController(db, auth as never, policy as never);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const request = { auth: { businessId: business.id, userId: "cashier", role: "cashier" },
      headers: { "idempotency-key": "credit-denied-key" } } as unknown as Request;
    await controller.adjustStoreCredit(request, response, customer.id, {
      amountMinor: 100, reason: "Unsupported correction",
    });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(await db.findStoreCreditAccount(customer.id, business.id)).toBeNull();
  });
});

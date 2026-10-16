import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createMemoryDb } from "../common/memory.db";
import { ValueController } from "./value.controller";
import { StoredValueService } from "./stored-value.service";

describe("ValueController read authorization", () => {
  it("restricts management ledgers by both role and effective permissions without blocking checkout balances", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Value permission QA", currency: "PHP" });
    const customer = await db.createCustomer({ businessId: business.id, name: "QA buyer",
      phone: null, email: null, address: null, notes: null, isActive: true });
    const giftCode = "NXP-GC-QA-TEST-ONLY";
    const valueService = new StoredValueService(db);
    const card = await db.createGiftCard({ businessId: business.id,
      codeHash: valueService.hashGiftCardCode(giftCode), codePrefix: "NXP-GC", codeLast4: "ONLY",
      status: "ACTIVE", createdBy: "owner", activatedAt: new Date(), suspendedAt: null, version: 1 });
    const auth = { permissionsForRequest: vi.fn((actor: { effectivePermissions?: string[] }) => actor.effectivePermissions ?? []) };
    const controller = new ValueController(db, auth as never, {} as never);
    const request = (role: string, effectivePermissions: string[]) => ({
      auth: { role, businessId: business.id, userId: role, effectivePermissions },
      headers: {}, ip: "127.0.0.1",
    } as unknown as Request);
    const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response);
    const managementEndpoints = [
      (req: Request, res: Response) => controller.listGiftCards(req, res),
      (req: Request, res: Response) => controller.storedValueReport(req, res),
      (req: Request, res: Response) => controller.giftCardHistory(req, res, card.id),
      (req: Request, res: Response) => controller.customerValueHistory(req, res, customer.id),
    ];
    for (const [role, permissions, allowed] of [
      ["cashier", [], false],
      ["inventory", ["gift_card.manage", "stored_value.adjust"], false],
      ["manager", [], false],
      ["manager", ["gift_card.manage", "stored_value.adjust"], true],
      ["owner", ["gift_card.manage", "stored_value.adjust"], true],
    ] as const) {
      for (const endpoint of managementEndpoints) {
        const res = response();
        await endpoint(request(role, [...permissions]), res);
        if (allowed) {
          expect(res.status).not.toHaveBeenCalledWith(403);
          expect(res.json).toHaveBeenCalled();
        } else {
          expect(res.status).toHaveBeenCalledWith(403);
          expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN" }));
        }
      }
    }
    const cashierReq = request("cashier", []);
    const customerBalance = response();
    await controller.customerValue(cashierReq, customerBalance, customer.id);
    expect(customerBalance.json).toHaveBeenCalledWith({ customerId: customer.id, storeCreditMinor: 0, loyaltyPoints: 0 });
    const giftLookup = response();
    await controller.lookupGiftCard(cashierReq, giftLookup, giftCode);
    expect(giftLookup.json).toHaveBeenCalledWith(expect.objectContaining({ id: card.id, codeLast4: "ONLY" }));
  });
});

describe("ValueController approval fingerprints", () => {
  it("records a manager-applied audit within each authorized value-adjustment transaction", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Approved value audit", currency: "PHP" });
    const customer = await db.createCustomer({ businessId: business.id, name: "Synthetic customer",
      phone: null, email: null, address: null, notes: null, isActive: true });
    const card = await db.createGiftCard({ businessId: business.id,
      codeHash: "synthetic-hash", codePrefix: "SYNTH", codeLast4: "0001", status: "ACTIVE",
      createdBy: "owner", activatedAt: new Date(), suspendedAt: null, version: 1 });
    const auth = {
      permissionsForRequest: vi.fn().mockReturnValue([]),
      consumeManagerApproval: vi.fn().mockResolvedValue({ approverId: "manager" }),
    };
    const policy = { resolveRequirement: vi.fn().mockImplementation(async (
      _businessId: string, _userId: string, action: { valueType: string },
    ) => ({ permission: action.valueType === "loyalty" ? "loyalty.adjust" : "stored_value.adjust",
      fingerprint: "synthetic-fingerprint", requireDistinctApprover: false })) };
    const controller = new ValueController(db, auth as never, policy as never);
    const request = (key: string) => ({ auth: { businessId: business.id, userId: "cashier", role: "cashier" },
      headers: { "idempotency-key": key } } as unknown as Request);
    const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response);
    const body = { amountMinor: 25, reason: "Documented correction", approvalToken: "synthetic-approval-token-for-test" };
    const creditResponse = response();
    const loyaltyResponse = response();
    const giftResponse = response();
    await controller.adjustStoreCredit(request("credit-audit-key"), creditResponse, customer.id, body);
    await controller.adjustLoyalty(request("loyalty-audit-key"), loyaltyResponse, customer.id, body);
    await controller.adjustGiftCard(request("gift-audit-key"), giftResponse, card.id, body);
    expect(creditResponse.json).toHaveBeenCalledWith({ customerId: customer.id, balanceMinor: 25 });
    expect(loyaltyResponse.json).toHaveBeenCalledWith({ customerId: customer.id, points: 25 });
    expect(giftResponse.json).toHaveBeenCalledWith(expect.objectContaining({ id: card.id, balanceMinor: 25 }));
    const audits = (await db.listAudit()).filter((row) => row.action === "manager.approval.applied");
    expect(audits).toHaveLength(3);
    expect(audits.map((row) => row.after)).toEqual([
      { approverId: "manager", amountDelta: 25, reason: body.reason },
      { approverId: "manager", amountDelta: 25, reason: body.reason },
      { approverId: "manager", amountDelta: 25, reason: body.reason },
    ]);
  });
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

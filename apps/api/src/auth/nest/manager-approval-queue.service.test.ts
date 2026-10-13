import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../../common/request-context";
import { createMemoryDb } from "../../common/memory.db";
import { AuthService } from "./auth.service";
import { ManagerApprovalPolicyService } from "./manager-approval-policy.service";
import { StoredValueService } from "../../value/stored-value.service";
import { ManagerApprovalQueueService } from "./manager-approval-queue.service";

const originalKey = process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
const KEY = "a6".repeat(32);
afterEach(() => {
  vi.useRealTimers();
  if (originalKey === undefined) delete process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
  else process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = originalKey;
});

async function setup() {
  process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = KEY;
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Queue Store", currency: "PHP" });
  const cashier = await db.createUser({ name: "Cashier", email: "cashier@example.com", passwordHash: "unused" });
  const manager = await db.createUser({ name: "Manager", email: "manager@example.com", passwordHash: "unused" });
  const owner = await db.createUser({ name: "Owner", email: "owner@example.com", passwordHash: "unused" });
  await db.createMembership({ businessId: business.id, userId: cashier.id, role: "cashier", deactivatedAt: null });
  await db.createMembership({ businessId: business.id, userId: manager.id, role: "manager", deactivatedAt: null });
  await db.createMembership({ businessId: business.id, userId: owner.id, role: "owner", deactivatedAt: null });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const register = await db.createRegister({ businessId: business.id, name: "Counter", isActive: true, branchId: branch.id });
  const shift = await db.createShift({
    businessId: business.id, registerId: register.id, branchId: branch.id, status: "OPEN", openedBy: "another-cashier", closedBy: null,
    openingFloatMinor: 10000, countedCashMinor: null, varianceMinor: null, cashSalesMinor: 0, cashRefundsMinor: 0,
    cashExpensesMinor: 0, cashDepositsMinor: 0, cashWithdrawalsMinor: 0, adjustmentsMinor: 0, expectedCashMinor: 12500, closeNotes: null,
  });
  const auth = {
    permissionsForRequest: (actor: RequestAuth) => actor.role === "owner"
      ? ["shift.close.override", "discount.override", "sale.refund", "refund.override", "sale.void", "inventory.adjust", "stored_value.adjust", "loyalty.adjust"]
      : actor.role === "manager" ? ["shift.close.override", "discount.override", "sale.refund", "sale.void", "inventory.adjust", "stored_value.adjust", "loyalty.adjust"] : [],
    mintManagerApproval: vi.fn(async () => ({ token: "one-use-manager-grant-token", expiresAt: new Date(Date.now() + 120_000) })),
  } as unknown as AuthService;
  const policy = new ManagerApprovalPolicyService(db);
  const queue = new ManagerApprovalQueueService(db, auth, policy);
  const cashierActor = { userId: cashier.id, businessId: business.id, role: "cashier", activeBranchId: branch.id, allowedBranchIds: [branch.id], allowedRegisterIds: [register.id] } as RequestAuth;
  const managerActor = { userId: manager.id, businessId: business.id, role: "manager", activeBranchId: branch.id, allowedBranchIds: [branch.id], allowedRegisterIds: [register.id] } as RequestAuth;
  const ownerActor = { userId: owner.id, businessId: business.id, role: "owner", activeBranchId: branch.id, allowedBranchIds: [branch.id], allowedRegisterIds: [register.id] } as RequestAuth;
  const action = { kind: "shift_close" as const, shiftId: shift.id, countedCashMinor: 12000 };
  return { db, queue, cashierActor, managerActor, ownerActor, register, shift, action, manager, owner };
}

describe("ManagerApprovalQueueService", () => {
  it("queues branch-scoped inventory movements without inventing a register or executing the movement", async () => {
    const { db, queue, cashierActor, managerActor, register } = await setup();
    const product = await db.createProduct({
      businessId: cashierActor.businessId, categoryId: null, name: "Queue inventory item", sku: "QUEUE-INV",
      barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    const action = {
      kind: "inventory_movement" as const, productId: product.id, movementType: "adjustment" as const,
      qtyDelta: -2, reason: "Damaged stock", branchId: register.branchId!,
    };
    const created = await queue.request(cashierActor, "inventory-request", action, null, "inventory-queue-1");
    expect(created.request).toMatchObject({ kind: "inventory_movement", status: "PENDING", branchId: register.branchId, registerId: null });
    await expect(queue.list(managerActor)).resolves.toEqual([expect.objectContaining({
      id: created.request.id, permission: "inventory.adjust", context: {
        productName: "Queue inventory item", movementType: "adjustment", qtyDelta: -2, reason: "Damaged stock",
      },
    })]);
    await queue.decide(managerActor, "inventory-approve", created.request.id, {
      decision: "APPROVED", email: "manager@example.com", password: "verified",
    });
    await expect(db.listMovements(product.id, cashierActor.businessId, register.branchId!)).resolves.toHaveLength(0);
    await expect(queue.claim(cashierActor, created.request.id)).resolves.toMatchObject({ token: "one-use-manager-grant-token" });
    await expect(queue.claim(cashierActor, created.request.id)).rejects.toThrow("APPROVAL_TOKEN_UNAVAILABLE");
  });

  it("queues global customer value actions for unrestricted cashiers and managers", async () => {
    const { db, queue, cashierActor, managerActor, manager } = await setup();
    const customer = await db.createCustomer({
      businessId: cashierActor.businessId, name: "Queue value customer", phone: null, email: null,
      address: null, notes: null, isActive: true,
    });
    await new StoredValueService(db).ensureStoreCreditAccount(cashierActor.businessId, customer.id);
    const unrestrictedCashier = { ...cashierActor, activeBranchId: null, allowedBranchIds: null, allowedRegisterIds: null } as RequestAuth;
    const unrestrictedManager = { ...managerActor, allowedBranchIds: null, allowedRegisterIds: null } as RequestAuth;
    const requested = await queue.request(unrestrictedCashier, "value-request", {
      kind: "value_adjustment", valueType: "store_credit", targetId: customer.id,
      amountDelta: 500, reason: "Customer service correction",
    }, null, "value-queue-key");
    await expect(queue.list(unrestrictedManager)).resolves.toEqual([expect.objectContaining({
      id: requested.request.id, kind: "value_adjustment", branchId: null,
      context: { targetLabel: "Queue value customer", valueType: "store_credit" },
    })]);
    await queue.decide(unrestrictedManager, "value-decision", requested.request.id, {
      decision: "APPROVED", email: manager.email, password: "verified",
    });
    await expect(queue.claim(unrestrictedCashier, requested.request.id)).resolves.toMatchObject({
      token: "one-use-manager-grant-token",
    });
  });

  it("queues only submitted stock counts and gives managers snapshot variance context", async () => {
    const { db, queue, cashierActor, managerActor, register } = await setup();
    const count = await db.createInventoryCount({
      businessId: cashierActor.businessId, branchId: register.branchId ?? null, countNumber: "COUNT-QUEUE-1", status: "SUBMITTED",
      scopeType: "PARTIAL", name: "Damaged goods count", notes: null, createdBy: cashierActor.userId,
      startedAt: new Date(), submittedBy: cashierActor.userId, submittedAt: new Date(), approvedBy: null, approvedAt: null,
      approvalFingerprint: null, postedBy: null, postedAt: null, cancelledBy: null, cancelledAt: null, version: 2,
    });
    await db.createInventoryCountLine({
      businessId: cashierActor.businessId, inventoryCountId: count.id, productId: "product-queue-count",
      expectedQtySnapshot: 8, balanceUpdatedAtSnapshot: null, countedQty: 6, varianceQty: -2,
      productNameSnapshot: "Canned beans", skuSnapshot: "BEANS-1", notes: null, countedBy: cashierActor.userId, countedAt: new Date(),
    });
    const request = await queue.request(cashierActor, "count-request", { kind: "inventory_count", countId: count.id }, null, "count-queue-key");
    expect(request.request).toMatchObject({ kind: "inventory_count", branchId: register.branchId, registerId: null, status: "PENDING" });
    await expect(queue.list(managerActor)).resolves.toEqual([expect.objectContaining({
      id: request.request.id, context: {
        countNumber: "COUNT-QUEUE-1", countStatus: "SUBMITTED",
        varianceLines: [{ name: "Canned beans", expectedQty: 8, countedQty: 6, varianceQty: -2 }],
      },
    })]);
    await queue.decide(managerActor, "count-approve", request.request.id, { decision: "APPROVED", email: "manager@example.com", password: "verified" });
    await expect(queue.claim(cashierActor, request.request.id)).resolves.toMatchObject({ token: "one-use-manager-grant-token" });
    const draft = await db.createInventoryCount({
      businessId: cashierActor.businessId, branchId: register.branchId ?? null, countNumber: "COUNT-DRAFT-1", status: "DRAFT",
      scopeType: "PARTIAL", name: "Draft count", notes: null, createdBy: cashierActor.userId,
      startedAt: null, submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null,
      approvalFingerprint: null, postedBy: null, postedAt: null, cancelledBy: null, cancelledAt: null, version: 1,
    });
    await expect(queue.request(cashierActor, "draft-count-request", { kind: "inventory_count", countId: draft.id }, null, "draft-count-queue-key")).rejects.toThrow("INVALID_STATE");
  });

  it("creates an idempotent, scoped shift-close request and exposes cash context to managers", async () => {
    const { queue, cashierActor, managerActor, register, action } = await setup();
    const first = await queue.request(cashierActor, "request-1", action, register.id, "shift-close-key-1");
    const replay = await queue.request(cashierActor, "request-2", action, register.id, "shift-close-key-1");
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, request: { id: first.request.id, status: "PENDING" } });
    await expect(queue.list(managerActor)).resolves.toEqual([expect.objectContaining({
      id: first.request.id,
      kind: "shift_close",
      context: { expectedCashMinor: 12500, countedCashMinor: 12000, varianceMinor: -500 },
    })]);
  });

  it("rejects a register mismatch and makes a request stale when the cash ledger changes", async () => {
    const { db, queue, cashierActor, managerActor, register, shift, action } = await setup();
    await expect(queue.request(cashierActor, "request-1", action, "other-register", "shift-close-key-2")).rejects.toThrow("FORBIDDEN");
    const requested = await queue.request(cashierActor, "request-1", action, register.id, "shift-close-key-2");
    await db.createCashMovement({ businessId: cashierActor.businessId, shiftId: shift.id, registerId: register.id, branchId: shift.branchId ?? null, type: "cash_deposit", amountMinor: 100, reason: null, referenceType: null, referenceId: null, actorId: cashierActor.userId, requestId: "ledger-change" });
    await expect(queue.decide(managerActor, "decision-1", requested.request.id, { decision: "APPROVED", email: "manager@example.com", password: "verified" })).rejects.toThrow("APPROVAL_REQUEST_STALE");
  });

  it("supports unassigned registers for unrestricted sessions while preserving branch restrictions", async () => {
    const { db, queue, cashierActor, managerActor, action } = await setup();
    const register = await db.createRegister({ businessId: cashierActor.businessId, name: "Unassigned till", isActive: true, branchId: null });
    const shift = await db.createShift({
      businessId: cashierActor.businessId, registerId: register.id, branchId: null, status: "OPEN", openedBy: "another-cashier", closedBy: null,
      openingFloatMinor: 0, countedCashMinor: null, varianceMinor: null, cashSalesMinor: 0, cashRefundsMinor: 0,
      cashExpensesMinor: 0, cashDepositsMinor: 0, cashWithdrawalsMinor: 0, adjustmentsMinor: 0, expectedCashMinor: 0, closeNotes: null,
    });
    const unrestricted = { ...cashierActor, activeBranchId: null, allowedBranchIds: null, allowedRegisterIds: null } as RequestAuth;
    const result = await queue.request(unrestricted, "request-unassigned", { ...action, shiftId: shift.id }, register.id, "unassigned-shift-key");
    expect(result.request).toMatchObject({ branchId: null, registerId: register.id, status: "PENDING" });
    const activeBranchManager = { ...managerActor, allowedBranchIds: null, allowedRegisterIds: null } as RequestAuth;
    await expect(queue.list(activeBranchManager)).resolves.toEqual([]);
    await expect(queue.decide(activeBranchManager, "unassigned-decision", result.request.id, {
      decision: "REJECTED", reason: "Outside active branch",
    })).rejects.toThrow("FORBIDDEN");
    await expect(queue.request(cashierActor, "request-restricted", { ...action, shiftId: shift.id }, register.id, "restricted-shift-key")).rejects.toThrow("FORBIDDEN");
  });

  it("queues refund and void authorizations with existing-sale context and no parallel execution", async () => {
    const { db, queue, cashierActor, managerActor, register } = await setup();
    const refundSale = await db.createSale({
      businessId: cashierActor.businessId, receiptNo: "REF-QUEUE-1", status: "REFUND_REQUESTED", subtotalMinor: 5000, discountMinor: 0,
      taxMinor: 0, totalMinor: 5000, paidMinor: 5000, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
      notes: null, actorId: cashierActor.userId, requestId: "refund-sale", idempotencyKey: null, registerId: register.id,
      branchId: register.branchId, createdAt: new Date(), completedAt: new Date(),
    });
    const refundLine = await db.createSaleItem({
      businessId: cashierActor.businessId, saleId: refundSale.id, productId: "product-1", name: "Tea", unit: "pc", qty: 2,
      priceMinor: 2500, costMinor: 500, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 5000,
    });
    await db.appendAudit({ businessId: cashierActor.businessId, actorId: cashierActor.userId, action: "refund.request", entityType: "Sale", entityId: refundSale.id, requestId: "refund-request" });
    const refund = await queue.request(cashierActor, "refund-queue", {
      kind: "refund", saleId: refundSale.id, items: [{ saleItemId: refundLine.id, qty: 1 }], reason: "Product issue",
    }, register.id, "refund-queue-key");
    expect(refund.request).toMatchObject({ status: "PENDING", kind: "refund" });
    await expect(queue.list(managerActor)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({
      id: refund.request.id, context: expect.objectContaining({ saleReceiptNo: "REF-QUEUE-1", saleStatus: "REFUND_REQUESTED", amountMinor: 2500, lineItems: [{ name: "Tea", qty: 1, amountMinor: 2500 }] }),
    })]));

    const voidSale = await db.createSale({
      businessId: cashierActor.businessId, receiptNo: "VOID-QUEUE-1", status: "DRAFT", subtotalMinor: 3000, discountMinor: 0,
      taxMinor: 0, totalMinor: 3000, paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
      notes: null, actorId: cashierActor.userId, requestId: "void-sale", idempotencyKey: null, registerId: register.id,
      branchId: register.branchId, createdAt: new Date(), completedAt: null,
    });
    const voided = await queue.request(cashierActor, "void-queue", { kind: "sale_void", saleId: voidSale.id, reason: "Duplicate transaction" }, register.id, "void-queue-key");
    expect(voided.request).toMatchObject({ status: "PENDING", kind: "sale_void" });
    const approvedRefund = await queue.decide(managerActor, "refund-decision", refund.request.id, {
      decision: "APPROVED", email: "manager@example.com", password: "verified",
    });
    expect(approvedRefund).toMatchObject({ status: "APPROVED", approverId: managerActor.userId });
    await queue.decide(managerActor, "void-decision", voided.request.id, { decision: "REJECTED", reason: "Review denied" });
    expect(await db.findSaleById(refundSale.id, cashierActor.businessId)).toMatchObject({ status: "REFUND_REQUESTED" });
    expect(await db.findSaleById(voidSale.id, cashierActor.businessId)).toMatchObject({ status: "DRAFT" });
  });

  it("reserves above-threshold refund approvals for owners", async () => {
    const { db, queue, cashierActor, managerActor, ownerActor, register, owner } = await setup();
    await db.saveSettings(cashierActor.businessId, { refundApprovalThresholdMinor: 1000 });
    const sale = await db.createSale({
      businessId: cashierActor.businessId, receiptNo: "REF-OWNER-1", status: "REFUND_REQUESTED", subtotalMinor: 5000, discountMinor: 0,
      taxMinor: 0, totalMinor: 5000, paidMinor: 5000, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
      notes: null, actorId: cashierActor.userId, requestId: "owner-refund-sale", idempotencyKey: null, registerId: register.id,
      branchId: register.branchId, createdAt: new Date(), completedAt: new Date(),
    });
    const line = await db.createSaleItem({
      businessId: cashierActor.businessId, saleId: sale.id, productId: "product-owner", name: "High value item", unit: "pc", qty: 1,
      priceMinor: 5000, costMinor: 1000, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 5000,
    });
    await db.appendAudit({ businessId: cashierActor.businessId, actorId: cashierActor.userId, action: "refund.request", entityType: "Sale", entityId: sale.id, requestId: "owner-refund-request" });
    const created = await queue.request(cashierActor, "owner-refund-queue", {
      kind: "refund", saleId: sale.id, items: [{ saleItemId: line.id, qty: 1 }], reason: "High-value return",
    }, register.id, "owner-refund-key");

    await expect(queue.list(managerActor)).resolves.toEqual([]);
    await expect(queue.decide(managerActor, "manager-high-refund", created.request.id, {
      decision: "APPROVED", email: "manager@example.com", password: "verified",
    })).rejects.toThrow("FORBIDDEN");
    await expect(queue.list(ownerActor)).resolves.toEqual([expect.objectContaining({
      id: created.request.id, permission: "refund.override", kind: "refund",
    })]);
    await expect(queue.decide(ownerActor, "owner-high-refund", created.request.id, {
      decision: "APPROVED", email: owner.email, password: "verified",
    })).resolves.toMatchObject({ status: "APPROVED", approverId: owner.id });
    await expect(db.findSaleById(sale.id, cashierActor.businessId)).resolves.toMatchObject({ status: "REFUND_REQUESTED" });
  });

  it("hands the exact short-lived grant to the requester once", async () => {
    const { queue, cashierActor, managerActor, register, action, manager } = await setup();
    const created = await queue.request(cashierActor, "request-1", action, register.id, "shift-close-key-3");
    await queue.decide(managerActor, "decision-1", created.request.id, { decision: "APPROVED", email: manager.email, pin: "123456" });
    const claimed = await queue.claim(cashierActor, created.request.id);
    expect(claimed).toMatchObject({ token: "one-use-manager-grant-token", approver: { id: manager.id, role: "manager" } });
    expect(Date.parse(claimed.expiresAt)).toBeGreaterThan(Date.now());
    await expect(queue.claim(cashierActor, created.request.id)).rejects.toThrow("APPROVAL_TOKEN_UNAVAILABLE");
  });

  it("audits expiry when a manager attempts to decide an aged request directly", async () => {
    const { db, queue, cashierActor, managerActor, register, action } = await setup();
    const created = await queue.request(cashierActor, "expired-decision-request", action, register.id, "expired-decision-key");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));

    await expect(queue.decide(managerActor, "expired-decision-attempt", created.request.id, {
      decision: "REJECTED", reason: "Too late to review",
    })).rejects.toThrow("APPROVAL_REQUEST_EXPIRED");

    await expect(db.findManagerApprovalRequest(created.request.id, cashierActor.businessId)).resolves.toMatchObject({ status: "EXPIRED" });
    await expect(db.listAuditFor(cashierActor.businessId, "ManagerApprovalRequest", created.request.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "manager.approval.expired",
        actorId: managerActor.userId,
        requestId: "expired-decision-attempt",
        before: { status: "PENDING" },
        after: { status: "EXPIRED" },
      }),
    ]));
  });
});

import { describe, expect, it } from "vitest";
import type { DbPort } from "../../common/db.port";
import { createMemoryDb } from "../../common/memory.db";
import { discountApprovalFingerprint } from "../../sales/discount-approval";
import { ManagerApprovalPolicyService } from "./manager-approval-policy.service";

async function setup(): Promise<{ db: DbPort; policy: ManagerApprovalPolicyService; businessId: string; requesterId: string; saleId: string; itemId: string; productId: string; branchId: string; shiftId: string }> {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Policy Store", currency: "PHP" });
  const requester = await db.createUser({ name: "Cashier", email: "policy-cashier@example.com", passwordHash: "unused" });
  await db.createMembership({ businessId: business.id, userId: requester.id, role: "cashier", deactivatedAt: null });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Coffee", sku: null, barcode: null, brand: null, unit: "pc",
    costMinor: 50, priceMinor: 2500, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  const sale = await db.createSale({
    businessId: business.id, receiptNo: "R-1", status: "COMPLETED", subtotalMinor: 5000, discountMinor: 0,
    taxMinor: 0, totalMinor: 5000, paidMinor: 5000, changeMinor: 0, currency: "PHP", customerId: null,
    customerName: null, notes: null, actorId: requester.id, requestId: "sale-request", idempotencyKey: null,
    registerId: null, branchId: branch.id, createdAt: new Date(), completedAt: new Date(),
  });
  const item = await db.createSaleItem({
    businessId: business.id, saleId: sale.id, productId: product.id, name: product.name, unit: product.unit,
    qty: 2, priceMinor: 2500, costMinor: 50, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 5000,
  });
  const register = await db.createRegister({ businessId: business.id, name: "Counter", isActive: true, branchId: branch.id });
  const shift = await db.createShift({
    businessId: business.id, registerId: register.id, branchId: branch.id, status: "OPEN", openedBy: "someone-else", closedBy: null,
    openingFloatMinor: 0, countedCashMinor: null, varianceMinor: null, cashSalesMinor: 0, cashRefundsMinor: 0,
    cashExpensesMinor: 0, cashDepositsMinor: 0, cashWithdrawalsMinor: 0, adjustmentsMinor: 0, expectedCashMinor: 0, closeNotes: null,
  });
  return { db, policy: new ManagerApprovalPolicyService(db), businessId: business.id, requesterId: requester.id, saleId: sale.id, itemId: item.id, productId: product.id, branchId: branch.id, shiftId: shift.id };
}

describe("ManagerApprovalPolicyService", () => {
  it("normalizes discount ordering into the same exact-action fingerprint", async () => {
    const { policy, businessId, requesterId } = await setup();
    const first = await policy.resolveRequirement(businessId, requesterId, {
      kind: "discount", orderDiscountMinor: 0,
      lines: [{ productId: "b", qty: 1, lineDiscountMinor: 10 }, { productId: "a", qty: 2, lineDiscountMinor: 20 }],
    });
    const second = await policy.resolveRequirement(businessId, requesterId, {
      kind: "discount", orderDiscountMinor: 0,
      lines: [{ productId: "a", qty: 2, lineDiscountMinor: 20 }, { productId: "b", qty: 1, lineDiscountMinor: 10 }],
    });
    expect(first).toMatchObject({ permission: "discount.override", requireDistinctApprover: false });
    expect(first?.fingerprint).toBe(second?.fingerprint);
  });

  it("resolves refund thresholds and rejects impossible refund quantities", async () => {
    const { db, policy, businessId, requesterId, saleId, itemId } = await setup();
    await db.saveSettings(businessId, { refundApprovalThresholdMinor: 6000 });
    const action = { kind: "refund" as const, saleId, items: [{ saleItemId: itemId, qty: 1 }] };
    await expect(policy.resolveRequirement(businessId, requesterId, action)).resolves.toMatchObject({ permission: "sale.refund" });
    await db.saveSettings(businessId, { refundApprovalThresholdMinor: 2000 });
    await expect(policy.resolveRequirement(businessId, requesterId, action)).resolves.toMatchObject({ permission: "refund.override" });
    await expect(policy.resolveRequirement(businessId, requesterId, { ...action, items: [{ saleItemId: itemId, qty: 3 }] })).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
  });

  it("includes the normalized delivery refund in threshold selection and exact-action fingerprint", async () => {
    const { db, policy, businessId, requesterId, saleId, itemId } = await setup();
    await db.updateSale(saleId, businessId, {
      deliveryFeeMinor: 1000,
      deliveryTaxMinor: 120,
      totalMinor: 6120,
      paidMinor: 6120,
    });
    await db.saveSettings(businessId, { refundApprovalThresholdMinor: 1000 });
    const action = {
      kind: "refund" as const,
      saleId,
      items: [],
      deliveryRefundMinor: 1120,
    };
    const requirement = await policy.resolveRequirement(businessId, requesterId, action);
    expect(requirement).toMatchObject({ permission: "refund.override" });
    const different = await policy.resolveRequirement(businessId, requesterId, {
      kind: "refund",
      saleId,
      items: [{ saleItemId: itemId, qty: 1 }],
      deliveryRefundMinor: 0,
    });
    expect(requirement?.fingerprint).not.toBe(different?.fingerprint);
  });

  it("requires a distinct approver for a non-owner who requested the refund", async () => {
    const { db, policy, businessId, requesterId, saleId, itemId } = await setup();
    await db.updateSale(saleId, businessId, { status: "REFUND_REQUESTED" });
    await db.appendAudit({ businessId, actorId: requesterId, action: "refund.request", entityType: "Sale", entityId: saleId, requestId: "refund-request" });
    const requirement = await policy.resolveRequirement(businessId, requesterId, {
      kind: "refund", saleId, items: [{ saleItemId: itemId, qty: 1 }], reason: "Customer changed mind",
    });
    expect(requirement).toMatchObject({ permission: "sale.refund", requireDistinctApprover: true });
  });

  it("validates void, branch-bound inventory, and foreign-shift actions", async () => {
    const { db, policy, businessId, requesterId, saleId, productId, branchId, shiftId } = await setup();
    await db.updateSale(saleId, businessId, { status: "DRAFT" });
    await expect(policy.resolveRequirement(businessId, requesterId, {
      kind: "sale_void", saleId, reason: "  Duplicate order  ",
    })).resolves.toMatchObject({ permission: "sale.void" });
    await expect(policy.resolveRequirement(businessId, requesterId, {
      kind: "inventory_movement", productId, movementType: "adjustment", qtyDelta: -1, reason: "Stock count", branchId,
    })).resolves.toMatchObject({ permission: "inventory.adjust" });
    await expect(policy.resolveRequirement(businessId, requesterId, {
      kind: "shift_close", shiftId, countedCashMinor: 0,
    })).resolves.toMatchObject({ permission: "shift.close.override" });
  });

  it("changes a foreign-shift requirement when its cash ledger changes", async () => {
    const { db, policy, businessId, requesterId, shiftId } = await setup();
    const action = { kind: "shift_close" as const, shiftId, countedCashMinor: 0 };
    const before = await policy.resolveRequirement(businessId, requesterId, action);
    const shift = await db.findShiftById(shiftId, businessId);
    await db.createCashMovement({
      businessId,
      shiftId,
      registerId: shift!.registerId,
      branchId: shift!.branchId ?? null,
      type: "cash_deposit",
      amountMinor: 100,
      reason: null,
      referenceType: null,
      referenceId: null,
      actorId: "someone-else",
      requestId: "cash-change",
    });
    const after = await policy.resolveRequirement(businessId, requesterId, action);
    expect(after?.stateFingerprint).not.toBe(before?.stateFingerprint);
    expect(after?.fingerprint).not.toBe(before?.fingerprint);
  });

  // Regression: a discount grant is minted by POST /api/v1/approvals/manager
  // (this service) but consumed by POST /api/v1/sales/drafts through
  // discountApprovalFingerprint(). If those two payload shapes ever diverge the
  // consumption raises FORBIDDEN and no cashier can ever complete an
  // over-threshold discount, so the parity is asserted directly.
  it("keeps the discount fingerprint identical to the sales draft consumption fingerprint", async () => {
    const { policy, businessId, requesterId } = await setup();
    const lines = [
      { productId: "prod-b", qty: 1, lineDiscountMinor: 1000 },
      { productId: "prod-a", qty: 3, lineDiscountMinor: 250 },
    ];
    const requirement = await policy.resolveRequirement(businessId, requesterId, {
      kind: "discount",
      orderDiscountMinor: 500,
      lines,
    });
    expect(requirement?.permission).toBe("discount.override");
    expect(requirement?.fingerprint).toBe(
      discountApprovalFingerprint({ lines, orderDiscountMinor: 500 }),
    );
  });

  it("keeps the discount fingerprint order-independent against the draft consumption fingerprint", async () => {
    const { policy, businessId, requesterId } = await setup();
    const forward = [
      { productId: "prod-a", qty: 2, lineDiscountMinor: 10 },
      { productId: "prod-b", qty: 1, lineDiscountMinor: 20 },
    ];
    const reversed = [...forward].reverse();
    const requirement = await policy.resolveRequirement(businessId, requesterId, {
      kind: "discount",
      orderDiscountMinor: 0,
      lines: forward,
    });
    expect(requirement?.fingerprint).toBe(
      discountApprovalFingerprint({ lines: reversed, orderDiscountMinor: 0 }),
    );
  });
});

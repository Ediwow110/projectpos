import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { CustomerConcernService } from "./customer-concern.service";

async function fixture() {
  const db = createMemoryDb();
  const sale = await db.createSale({
    businessId: "b1", receiptNo: "2026-000100", status: "COMPLETED", subtotalMinor: 5000,
    discountMinor: 0, taxMinor: 0, totalMinor: 5000, paidMinor: 5000, changeMinor: 0,
    currency: "PHP", customerId: null, customerName: null, notes: null, actorId: "cashier",
    requestId: "sale-request", idempotencyKey: null, registerId: "register-1", branchId: "branch-1", createdAt: new Date(),
  });
  const line = await db.createSaleItem({
    businessId: "b1", saleId: sale.id, position: 0, productId: "product-1", name: "Coffee",
    unit: "pc", qty: 2, priceMinor: 2500, costMinor: 1000, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 5000,
  });
  return { db, sale, line, service: new CustomerConcernService(db) };
}

const input = (saleId: string, saleItemId: string, qty = 1) => ({
  saleId, items: [{ saleItemId, qty }], reason: "DAMAGED", outcome: "REFUND", note: "Seal was broken",
});

describe("CustomerConcernService", () => {
  it("submits and replays a case without changing sale or stock", async () => {
    const { db, sale, line, service } = await fixture();
    const first = await service.submit("b1", "cashier", "request-1", "case-key-1", input(sale.id, line.id));
    const replay = await service.submit("b1", "cashier", "request-2", "case-key-1", input(sale.id, line.id));
    expect(first.concern).toMatchObject({ status: "PENDING", requestedRefundMinor: 2500, items: [{ qty: 1, amountMinor: 2500 }] });
    expect(replay).toMatchObject({ replayed: true, concern: { id: first.concern.id } });
    expect(await db.findSaleById(sale.id, "b1")).toMatchObject({ status: "COMPLETED", paidMinor: 5000 });
    expect(await db.listRefundsBySale(sale.id, "b1")).toEqual([]);
    expect(await db.listRefundItemsBySale(sale.id, "b1")).toEqual([]);
  });

  it("serializes competing requests and refuses quantities already reserved", async () => {
    const { sale, line, service } = await fixture();
    await Promise.all([
      service.submit("b1", "cashier", "request-a", "case-key-a", input(sale.id, line.id)),
      service.submit("b1", "cashier", "request-b", "case-key-b", input(sale.id, line.id)),
    ]);
    await expect(service.submit("b1", "cashier", "request-c", "case-key-c", input(sale.id, line.id)))
      .rejects.toThrow("RETURN_EXCEEDS_RETURNABLE");
  });

  it("refuses complaint intake for pending, unknown, failed, or underpaid sales", async () => {
    const cases = [
      { status: "PENDING_PAYMENT", paidMinor: 0 },
      { status: "PAYMENT_UNKNOWN", paidMinor: 0 },
      { status: "PAYMENT_FAILED", paidMinor: 0 },
      { status: "COMPLETED", paidMinor: 1000 },
    ] as const;
    for (const [index, state] of cases.entries()) {
      const { db, sale, line, service } = await fixture();
      await db.updateSale(sale.id, "b1", state);
      await expect(service.submit("b1", "cashier", `pending-${index}`, `pending-key-${index}`, input(sale.id, line.id)))
        .rejects.toThrow("SALE_NOT_RETURNABLE");
    }
  });

  it("allows only the unrefunded quantity on a partially refunded sale", async () => {
    const { db, sale, line, service } = await fixture();
    await db.updateSale(sale.id, "b1", { status: "PARTIALLY_REFUNDED" });
    const refund = await db.createRefund({
      businessId: "b1", saleId: sale.id, status: "APPROVED", totalMinor: 2500, reason: "First item returned",
      requestedBy: "manager", approvedBy: "manager", requestId: "refund-request", approvedRequestId: "refund-approval", singleStep: true,
    });
    await db.createRefundItem({
      businessId: "b1", refundId: refund.id, saleItemId: line.id, productId: "product-1",
      qty: 1, amountMinor: 2500, restocked: false,
    });

    const { concern } = await service.submit("b1", "cashier", "partial-request", "partial-case", input(sale.id, line.id));
    expect(concern).toMatchObject({ status: "PENDING", items: [{ saleItemId: line.id, qty: 1 }] });
    await expect(service.submit("b1", "cashier", "partial-over-request", "partial-over-case", input(sale.id, line.id)))
      .rejects.toThrow("RETURN_EXCEEDS_RETURNABLE");
  });

  it("records rejection in the audit trail and prevents a second decision", async () => {
    const { db, sale, line, service } = await fixture();
    const { concern } = await service.submit("b1", "cashier", "request-rejected", "case-rejected", input(sale.id, line.id));

    await expect(service.decide("b1", "manager", "decision-reject", concern.id, "REJECTED", "Item was not eligible", false))
      .resolves.toMatchObject({ status: "REJECTED", reviewedBy: "manager", reviewReason: "Item was not eligible" });
    await expect(service.decide("b1", "manager", "decision-replay", concern.id, "APPROVED", "Replay attempt", false))
      .rejects.toThrow("INVALID_STATE");
    await expect(db.listAuditFor("b1", "CustomerConcern", concern.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "customer_concern.reject", reason: "Item was not eligible" }),
    ]));
  });

  it("allows only one concurrent manager decision and writes one decision audit", async () => {
    const { db, sale, line, service } = await fixture();
    const { concern } = await service.submit("b1", "cashier", "request-race", "case-race", input(sale.id, line.id));
    const outcomes = await Promise.allSettled([
      service.decide("b1", "manager-a", "approve-race", concern.id, "APPROVED", "Approved by manager A", false),
      service.decide("b1", "manager-b", "reject-race", concern.id, "REJECTED", "Rejected by manager B", false),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const decisions = (await db.listAuditFor("b1", "CustomerConcern", concern.id))
      .filter((entry) => entry.action === "customer_concern.approve" || entry.action === "customer_concern.reject");
    expect(decisions).toHaveLength(1);
    expect(await service.find("b1", concern.id)).toMatchObject({ status: expect.stringMatching(/^(APPROVED|REJECTED)$/) });
  });

  it("rejects malformed input and hides sales from another business", async () => {
    const { sale, line, service } = await fixture();
    await expect(service.submit("b1", "cashier", "request-null", "case-null", null as unknown as ReturnType<typeof input>))
      .rejects.toThrow("VALIDATION");
    await expect(service.submit("b2", "cashier", "request-other", "case-other", input(sale.id, line.id)))
      .rejects.toThrow("NOT_FOUND");
    await expect(service.submit("b1", "cashier", "request-return", "case-return", {
      ...input(sale.id, line.id), outcome: "RETURN",
    })).rejects.toThrow("VALIDATION");
  });

  it("rejects receipt intake outside the caller's branch or register and prevents cross-user replay", async () => {
    const { sale, line, service } = await fixture();
    const branchRestricted = { activeBranchId: "branch-2", allowedBranchIds: ["branch-2"], allowedRegisterIds: null };
    const registerRestricted = { activeBranchId: "branch-1", allowedBranchIds: ["branch-1"], allowedRegisterIds: ["register-2"] };
    await expect(service.submit("b1", "cashier", "branch-request", "branch-case", input(sale.id, line.id), branchRestricted))
      .rejects.toThrow("FORBIDDEN");
    await expect(service.submit("b1", "cashier", "register-request", "register-case", input(sale.id, line.id), registerRestricted))
      .rejects.toThrow("FORBIDDEN");

    const created = await service.submit("b1", "cashier-1", "owner-request", "shared-case-key", input(sale.id, line.id));
    await expect(service.submit("b1", "cashier-2", "replay-request", "shared-case-key", input(sale.id, line.id)))
      .rejects.toThrow("FORBIDDEN");
    expect(created.concern.requesterId).toBe("cashier-1");
  });

  it("routes over-threshold cases to owner review and prevents manager decisions", async () => {
    const { db, sale, line, service } = await fixture();
    await db.saveSettings("b1", { refundApprovalThresholdMinor: 2000 });
    const { concern } = await service.submit("b1", "cashier", "request-1", "case-key-1", input(sale.id, line.id));
    expect(concern.status).toBe("OWNER_REVIEW");
    await expect(service.decide("b1", "manager", "decision-1", concern.id, "APPROVED", "Reviewed", false))
      .rejects.toThrow("FORBIDDEN");
    await expect(service.decide("b1", "owner", "decision-2", concern.id, "APPROVED", "Reviewed", true))
      .resolves.toMatchObject({ status: "APPROVED", reviewedBy: "owner" });
    await expect(service.decide("b1", "owner", "decision-3", concern.id, "REJECTED", "Duplicate", true))
      .rejects.toThrow("INVALID_STATE");
  });
});

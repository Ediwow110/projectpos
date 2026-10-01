import { Inject, Injectable } from "@nestjs/common";
import type { ManagerApprovalAction, ManagerApprovalPermission } from "@pos/validation";
import type { DbPort } from "../../common/db.port";
import { fingerprintPayload } from "../../sales/idempotency";
import { VALID_TRANSITIONS } from "../../sales/state-machine";
import { lineRefundAmount, refundableQty } from "../../refunds/refund-math";

export interface ManagerApprovalRequirement {
  permission: ManagerApprovalPermission;
  fingerprint: string;
  requireDistinctApprover: boolean;
}

function trimOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizedDiscountLines(lines: Extract<ManagerApprovalAction, { kind: "discount" }>["lines"]) {
  return [...lines]
    .map((line) => ({ ...line }))
    .sort((left, right) =>
      left.productId.localeCompare(right.productId)
      || left.qty - right.qty
      || left.lineDiscountMinor - right.lineDiscountMinor,
    );
}

@Injectable()
export class ManagerApprovalPolicyService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private async requireSale(businessId: string, saleId: string) {
    const sale = await this.db.findSaleById(saleId, businessId);
    if (!sale) throw new Error("NOT_FOUND");
    return sale;
  }

  private async normalizedRefund(
    businessId: string,
    saleId: string,
    items: Extract<ManagerApprovalAction, { kind: "refund" }>["items"],
  ): Promise<Array<{ saleItemId: string; qty: number; amountMinor: number }>> {
    const sale = await this.requireSale(businessId, saleId);
    if (!["COMPLETED", "REFUND_REQUESTED", "PARTIALLY_REFUNDED"].includes(sale.status)) {
      throw new Error("SALE_INVALID_TRANSITION");
    }
    const [lines, prior] = await Promise.all([
      this.db.listSaleItems(sale.id, businessId),
      this.db.listRefundItemsBySale(sale.id, businessId),
    ]);
    const refundedByLine = new Map<string, number>();
    for (const item of prior) {
      refundedByLine.set(item.saleItemId, (refundedByLine.get(item.saleItemId) ?? 0) + item.qty);
    }
    const requestedByLine = new Map<string, number>();
    for (const item of items) {
      requestedByLine.set(item.saleItemId, (requestedByLine.get(item.saleItemId) ?? 0) + item.qty);
    }
    return [...requestedByLine.entries()]
      .map(([saleItemId, qty]) => {
        const line = lines.find((candidate) => candidate.id === saleItemId);
        if (!line) throw new Error("VALIDATION");
        if (qty > refundableQty(line.qty, refundedByLine.get(line.id) ?? 0)) {
          throw new Error("REFUND_EXCEEDS_LIMIT");
        }
        return { saleItemId, qty, amountMinor: lineRefundAmount(line.lineTotalMinor, line.qty, qty) };
      })
      .sort((left, right) => left.saleItemId.localeCompare(right.saleItemId));
  }

  private async refundRequiresDistinctApprover(businessId: string, requesterId: string, saleId: string): Promise<boolean> {
    const sale = await this.requireSale(businessId, saleId);
    if (sale.status !== "REFUND_REQUESTED") return false;
    const audit = await this.db.listAudit();
    const latestRequest = [...audit].reverse().find((entry) =>
      entry.businessId === businessId
      && entry.entityType === "Sale"
      && entry.entityId === saleId
      && entry.action === "refund.request",
    );
    if (!latestRequest || latestRequest.actorId !== requesterId) return false;
    const membership = await this.db.findMembership(requesterId, businessId);
    return membership?.role !== "owner";
  }

  async resolveRequirement(
    businessId: string,
    requesterId: string,
    action: ManagerApprovalAction,
  ): Promise<ManagerApprovalRequirement | null> {
    switch (action.kind) {
      case "discount":
        return {
          permission: "discount.override",
          fingerprint: fingerprintPayload({
            kind: action.kind,
            lines: normalizedDiscountLines(action.lines),
            orderDiscountMinor: action.orderDiscountMinor,
          }),
          requireDistinctApprover: false,
        };
      case "refund": {
        const items = await this.normalizedRefund(businessId, action.saleId, action.items);
        const totalMinor = items.reduce((sum, item) => sum + item.amountMinor, 0);
        const threshold = (await this.db.getSettings(businessId))["refundApprovalThresholdMinor"];
        const permission: ManagerApprovalPermission = typeof threshold === "number" && totalMinor > threshold
          ? "refund.override"
          : "sale.refund";
        return {
          permission,
          fingerprint: fingerprintPayload({
            kind: action.kind,
            saleId: action.saleId,
            items: items.map(({ saleItemId, qty }) => ({ saleItemId, qty })),
            reason: trimOrNull(action.reason),
          }),
          requireDistinctApprover: await this.refundRequiresDistinctApprover(businessId, requesterId, action.saleId),
        };
      }
      case "sale_void": {
        const sale = await this.requireSale(businessId, action.saleId);
        if (!(VALID_TRANSITIONS[sale.status] ?? []).includes("VOIDED")) throw new Error("SALE_INVALID_TRANSITION");
        const reason = trimOrNull(action.reason);
        if (!reason || reason.length < 3) throw new Error("VALIDATION");
        return {
          permission: "sale.void",
          fingerprint: fingerprintPayload({ kind: action.kind, saleId: action.saleId, reason }),
          requireDistinctApprover: false,
        };
      }
      case "inventory_movement": {
        const product = await this.db.findProductById(action.productId, businessId);
        if (!product) throw new Error("NOT_FOUND");
        const branchId = action.branchId ?? null;
        if (branchId) {
          const branch = await this.db.findBranchById(branchId, businessId);
          if (!branch || !branch.isActive) throw new Error("VALIDATION");
        }
        return {
          permission: "inventory.adjust",
          fingerprint: fingerprintPayload({
            kind: action.kind,
            productId: action.productId,
            movementType: action.movementType,
            qtyDelta: action.qtyDelta,
            reason: trimOrNull(action.reason),
            branchId,
          }),
          requireDistinctApprover: false,
        };
      }
      case "shift_close": {
        const shift = await this.db.findShiftById(action.shiftId, businessId);
        if (!shift) throw new Error("NOT_FOUND");
        if (shift.status !== "OPEN") throw new Error("SHIFT_ALREADY_CLOSED");
        if (shift.openedBy === requesterId) return null;
        return {
          permission: "shift.close.override",
          fingerprint: fingerprintPayload({
            kind: action.kind,
            shiftId: action.shiftId,
            countedCashMinor: action.countedCashMinor,
            closeNotes: trimOrNull(action.closeNotes),
          }),
          requireDistinctApprover: false,
        };
      }
    }
  }
}

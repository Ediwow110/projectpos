import { Inject, Injectable } from "@nestjs/common";
import type { ManagerApprovalAction, ManagerApprovalPermission } from "@pos/validation";
import type { DbCashMovement, DbPort } from "../../common/db.port";
import { fingerprintPayload } from "../../sales/idempotency";
import { VALID_TRANSITIONS } from "../../sales/state-machine";
import { lineRefundAmount, refundableQty } from "../../refunds/refund-math";

export interface ManagerApprovalRequirement {
  permission: ManagerApprovalPermission;
  fingerprint: string;
  requireDistinctApprover: boolean;
  stateFingerprint?: string;
}

export interface AppliedManagerApproval {
  approverId: string;
  permission: ManagerApprovalPermission;
  stateFingerprint?: string;
}

export function shiftCashStateFingerprint(movements: readonly DbCashMovement[]): string {
  return fingerprintPayload(
    movements
      .map((movement) => ({ id: movement.id, type: movement.type, amountMinor: movement.amountMinor }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
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
    const audit = await this.db.listAudit(businessId);
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

  private async normalizedDeliveryRefund(
    businessId: string,
    saleId: string,
    requestedMinor: number | undefined,
  ): Promise<{ amountMinor: number; feeMinor: number; taxMinor: number }> {
    const requested = requestedMinor ?? 0;
    if (!Number.isInteger(requested) || requested < 0) throw new Error("VALIDATION");
    if (requested === 0) return { amountMinor: 0, feeMinor: 0, taxMinor: 0 };
    const sale = await this.requireSale(businessId, saleId);
    const prior = (await this.db.listRefundsBySale(saleId, businessId)).filter((row) => row.status === "APPROVED");
    const refundedFee = prior.reduce((sum, row) => sum + row.deliveryFeeRefundMinor, 0);
    const refundedTax = prior.reduce((sum, row) => sum + row.deliveryTaxRefundMinor, 0);
    const feeMinor = Math.max(0, sale.deliveryFeeMinor - refundedFee);
    const taxMinor = Math.max(0, sale.deliveryTaxMinor - refundedTax);
    const remaining = feeMinor + taxMinor;
    if (remaining <= 0 || requested > remaining) throw new Error("REFUND_EXCEEDS_LIMIT");
    if (requested !== remaining) throw new Error("VALIDATION");
    return { amountMinor: remaining, feeMinor, taxMinor };
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
        const deliveryRefund = await this.normalizedDeliveryRefund(
          businessId,
          action.saleId,
          action.deliveryRefundMinor,
        );
        const loads = await this.db.listSaleGiftCardLoads(action.saleId, businessId);
        const loadRefunds = new Map<string, number>();
        for (const row of action.loadRefunds ?? []) loadRefunds.set(row.loadId, (loadRefunds.get(row.loadId) ?? 0) + row.amountMinor);
        const normalizedLoadRefunds = [] as Array<{ loadId: string; amountMinor: number }>;
        for (const [loadId, amountMinor] of loadRefunds.entries()) {
          const load = loads.find((candidate) => candidate.id === loadId);
          if (!load || !load.giftCardId) throw new Error("VALIDATION");
          const transactions = await this.db.listGiftCardTransactions(load.giftCardId, businessId);
          const refunded = transactions.filter((row) => row.type === "LOAD_REFUND" && row.loadId === load.id).reduce((sum, row) => sum + Math.abs(row.amountDeltaMinor), 0);
          const balance = transactions.reduce((sum, row) => sum + row.amountDeltaMinor, 0);
          if (amountMinor > load.amountMinor - refunded) throw new Error("REFUND_EXCEEDS_LIMIT");
          if (amountMinor > balance) throw new Error("GIFT_CARD_LOAD_SPENT");
          normalizedLoadRefunds.push({ loadId, amountMinor });
        }
        normalizedLoadRefunds.sort((left, right) => left.loadId.localeCompare(right.loadId));
        const totalMinor =
          items.reduce((sum, item) => sum + item.amountMinor, 0)
          + normalizedLoadRefunds.reduce((sum, item) => sum + item.amountMinor, 0)
          + deliveryRefund.amountMinor;
        if (totalMinor <= 0) throw new Error("VALIDATION");
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
            loadRefunds: normalizedLoadRefunds,
            deliveryRefundMinor: deliveryRefund.amountMinor,
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
      case "inventory_count": {
        const count = await this.db.findInventoryCountById(action.countId, businessId);
        if (!count) throw new Error("NOT_FOUND");
        const lines = await this.db.listInventoryCountLines(count.id, businessId);
        return {
          permission: "inventory.adjust",
          fingerprint: fingerprintPayload({
            countId: count.id,
            version: count.version,
            branchId: count.branchId,
            lines: lines.map((line) => ({ productId: line.productId, expectedQtySnapshot: line.expectedQtySnapshot, countedQty: line.countedQty, varianceQty: line.varianceQty })).sort((a, b) => a.productId.localeCompare(b.productId)),
          }),
          requireDistinctApprover: false,
        };
      }
      case "shift_close": {
        const shift = await this.db.findShiftById(action.shiftId, businessId);
        if (!shift) throw new Error("NOT_FOUND");
        if (shift.status !== "OPEN") throw new Error("SHIFT_ALREADY_CLOSED");
        if (shift.openedBy === requesterId) return null;
        const stateFingerprint = shiftCashStateFingerprint(
          await this.db.listCashMovementsByShift(shift.id, businessId),
        );
        return {
          permission: "shift.close.override",
          fingerprint: fingerprintPayload({
            kind: action.kind,
            shiftId: action.shiftId,
            countedCashMinor: action.countedCashMinor,
            closeNotes: trimOrNull(action.closeNotes),
            branchId: shift.branchId ?? null,
            registerId: shift.registerId,
            stateFingerprint,
          }),
          requireDistinctApprover: false,
          stateFingerprint,
        };
      }
      case "value_adjustment": {
        const permission: ManagerApprovalPermission = action.valueType === "loyalty" ? "loyalty.adjust" : "stored_value.adjust";
        let state: { balance: number; version: string };
        if (action.valueType === "gift_card") {
          const card = await this.db.findGiftCardById(action.targetId, businessId);
          if (!card) throw new Error("NOT_FOUND");
          const balance = (await this.db.listGiftCardTransactions(card.id, businessId)).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
          state = { balance, version: String(card.version) };
        } else if (action.valueType === "store_credit") {
          if (!await this.db.findCustomerById(action.targetId, businessId)) throw new Error("NOT_FOUND");
          const account = await this.db.findStoreCreditAccount(action.targetId, businessId);
          const balance = account
            ? (await this.db.listStoreCreditTransactions(account.id, businessId)).reduce((sum, row) => sum + row.amountDeltaMinor, 0)
            : 0;
          state = { balance, version: account?.updatedAt.toISOString() ?? "absent" };
        } else {
          if (!await this.db.findCustomerById(action.targetId, businessId)) throw new Error("NOT_FOUND");
          const account = await this.db.findLoyaltyAccount(action.targetId, businessId);
          const balance = account
            ? (await this.db.listLoyaltyTransactions(account.id, businessId)).reduce((sum, row) => sum + row.pointsDelta, 0)
            : 0;
          state = { balance, version: account?.updatedAt.toISOString() ?? "absent" };
        }
        return {
          permission,
          fingerprint: fingerprintPayload({ kind: action.kind, businessId, requesterId, valueType: action.valueType, targetId: action.targetId, amountDelta: action.amountDelta, reason: action.reason.trim(), currentBalance: state.balance, currentVersion: state.version }),
          requireDistinctApprover: false,
          stateFingerprint: fingerprintPayload(state),
        };
      }
    }
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbPort, DbRefund, DbSale } from "../../common/db.port";
import { transitionSale } from "../../sales/state-machine";
import { fingerprintPayload } from "../../sales/idempotency";
import { ShiftService } from "../../shifts/nest/shift.service";
import { withInventoryLocks } from "../../inventory/inventory-locks";
import { lineRefundAmount, refundableQty } from "../refund-math";
import { refundLockKey } from "../refund-lock";
import type { AppliedManagerApproval } from "../../auth/nest/manager-approval-policy.service";

export interface RefundItemInput {
  saleItemId: string;
  qty: number;
}

const CASH_METHODS = new Set(["cash"]);

@Injectable()
export class RefundService {
  private readonly shifts: ShiftService;

  constructor(@Inject("DbPort") private readonly db: DbPort) {
    // Same-DbPort instance (not Nest DI) to avoid a Refund<->Shift DI cycle.
    this.shifts = new ShiftService(db);
  }

  private async requireSale(businessId: string, saleId: string): Promise<DbSale> {
    const sale = await this.db.findSaleById(saleId, businessId);
    if (!sale) throw new Error("NOT_FOUND");
    return sale;
  }

  private async findRequester(businessId: string, saleId: string): Promise<string | null> {
    const audit = await this.db.listAudit();
    const requests = audit.filter(
      (a) => a.businessId === businessId && a.entityType === "Sale" && a.entityId === saleId && a.action === "refund.request",
    );
    return requests.length === 0 ? null : requests[requests.length - 1].actorId;
  }

  async approveRefund(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    input: { items: RefundItemInput[]; reason?: string; key: string },
    granted: string[],
    role: string,
    approval?: AppliedManagerApproval,
  ): Promise<{ refund: DbRefund; sale: DbSale; replayed: boolean }> {
    withScope(businessId, {});
    if (!granted.includes("sale.refund")) throw new Error("FORBIDDEN");
    return this.db.withLock(refundLockKey(businessId, saleId), async () => {
      const requestedByLine = new Map<string, number>();
      for (const item of input.items) {
        requestedByLine.set(item.saleItemId, (requestedByLine.get(item.saleItemId) ?? 0) + item.qty);
      }
      const requestedItems = [...requestedByLine.entries()]
        .map(([saleItemId, qty]) => ({ saleItemId, qty }))
        .sort((left, right) => left.saleItemId.localeCompare(right.saleItemId));
      const fingerprint = fingerprintPayload({ saleId, items: requestedItems, reason: input.reason ?? null });
      const existing = await this.db.findIdempotency(businessId, input.key, "refund.approve");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const refund = await this.db.findRefundById(existing.resultId, businessId);
        if (!refund) throw new Error("NOT_FOUND");
        const sale = await this.requireSale(businessId, saleId);
        return { refund, sale, replayed: true };
      }
      const sale = await this.requireSale(businessId, saleId);
      if (sale.status !== "COMPLETED" && sale.status !== "REFUND_REQUESTED" && sale.status !== "PARTIALLY_REFUNDED") {
        throw new Error("SALE_INVALID_TRANSITION");
      }
      const singleStep = sale.status !== "REFUND_REQUESTED";
      if (!singleStep) {
        const requester = await this.findRequester(businessId, saleId);
        if (requester === actorId && role !== "owner" && !approval) {
          throw new Error("FORBIDDEN");
        }
      }
      const lines = await this.db.listSaleItems(sale.id, businessId);
      const prior = await this.db.listRefundItemsBySale(sale.id, businessId);
      const refundedByLine = new Map<string, number>();
      for (const ri of prior) {
        refundedByLine.set(ri.saleItemId, (refundedByLine.get(ri.saleItemId) ?? 0) + ri.qty);
      }
      const resolved = requestedItems.map((req) => {
        const line = lines.find((l) => l.id === req.saleItemId);
        if (!line) throw new Error("VALIDATION");
        if (!Number.isInteger(req.qty) || req.qty <= 0) throw new Error("VALIDATION");
        if (req.qty > refundableQty(line.qty, refundedByLine.get(line.id) ?? 0)) {
          throw new Error("REFUND_EXCEEDS_LIMIT");
        }
        return { line, qty: req.qty, amount: lineRefundAmount(line.lineTotalMinor, line.qty, req.qty) };
      });
      const totalMinor = resolved.reduce((sum, r) => sum + r.amount, 0);
      // FR-REFUND-02: approval follows role AND threshold policy. Above the
      // configured threshold only a role holding refund.override may approve.
      const threshold = (await this.db.getSettings(businessId))["refundApprovalThresholdMinor"];
      if (typeof threshold === "number" && totalMinor > threshold && !granted.includes("refund.override")) {
        throw new Error("FORBIDDEN");
      }
      // Allocate across original SUCCEEDED payments in order.
      const succeeded = (await this.db.listPaymentsBySale(sale.id, businessId)).filter(
        (p) => p.status === "SUCCEEDED",
      );
      let remaining = totalMinor;
      const allocations: Array<{ method: string; amount: number }> = [];
      for (const p of succeeded) {
        if (remaining <= 0) break;
        const portion = Math.min(remaining, p.amountMinor);
        allocations.push({ method: p.method, amount: portion });
        remaining -= portion;
      }
      if (remaining > 0) throw new Error("REFUND_EXCEEDS_LIMIT");
      const cashMinor = allocations
        .filter((a) => CASH_METHODS.has(a.method))
        .reduce((sum, a) => sum + a.amount, 0);
      if (cashMinor > 0 && sale.registerId) {
        const open = await this.db.findOpenShiftByRegister(businessId, sale.registerId);
        if (!open) throw new Error("SHIFT_NO_OPEN_SHIFT");
      }
      const reason = input.reason?.trim() ? input.reason.trim() : null;
      const refund = await this.db.createRefund({
        businessId,
        saleId: sale.id,
        status: "APPROVED",
        totalMinor,
        reason,
        requestedBy: singleStep ? actorId : ((await this.findRequester(businessId, saleId)) ?? actorId),
        approvedBy: actorId,
        requestId,
        approvedRequestId: requestId,
        singleStep,
      });
      const resolvedWithTracking = await Promise.all(
        resolved.map(async (row) => ({
          ...row,
          tracked: (await this.db.findProductById(row.line.productId, businessId))?.trackInventory === true,
          bundleComponents: await this.db.listSaleItemBundleComponents(row.line.id, businessId),
        })),
      );
      await withInventoryLocks(
        this.db,
        businessId,
        resolvedWithTracking
          .flatMap((row) => row.bundleComponents.length > 0
            ? row.bundleComponents.map((component) => ({ productId: component.componentProductId, branchId: sale.branchId ?? null }))
            : row.tracked ? [{ productId: row.line.productId, branchId: sale.branchId ?? null }] : []),
        async () => {
          for (const r of resolvedWithTracking) {
            const restocked = r.tracked || r.bundleComponents.length > 0;
            await this.db.createRefundItem({
              businessId,
              refundId: refund.id,
              saleItemId: r.line.id,
              productId: r.line.productId,
              qty: r.qty,
              amountMinor: r.amount,
              restocked,
            });
            if (r.bundleComponents.length > 0) {
              const saleBranchId = sale.branchId ?? null;
              for (const component of r.bundleComponents) {
                const qty = r.qty * component.quantityPerBundleSnapshot;
                const current = await this.db.findBalance(component.componentProductId, businessId, saleBranchId);
                const onHand = current?.qtyOnHand ?? 0;
                await this.db.createMovement({
                  businessId,
                  productId: component.componentProductId,
                  type: "return",
                  qtyDelta: qty,
                  reason: null,
                  referenceType: "Refund",
                  referenceId: refund.id,
                  actorId,
                  requestId,
                  branchId: saleBranchId,
                });
                await this.db.upsertBalance({
                  businessId,
                  branchId: saleBranchId,
                  productId: component.componentProductId,
                  qtyOnHand: onHand + qty,
                });
              }
            } else if (r.tracked) {
              const saleBranchId = sale.branchId ?? null;
              const current = await this.db.findBalance(
                r.line.productId,
                businessId,
                saleBranchId,
              );
              const onHand = current?.qtyOnHand ?? 0;
              await this.db.createMovement({
                businessId,
                productId: r.line.productId,
                type: "return",
                qtyDelta: r.qty,
                reason: null,
                referenceType: "Refund",
                referenceId: refund.id,
                actorId,
                requestId,
                branchId: saleBranchId,
              });
              await this.db.upsertBalance({
                businessId,
                branchId: saleBranchId,
                productId: r.line.productId,
                qtyOnHand: onHand + r.qty,
              });
            }
          }
        },
      );
      for (const [legIndex, a] of allocations.entries()) {
        await this.db.createPayment({
          businessId,
          saleId: sale.id,
          method: a.method,
          amountMinor: a.amount,
          status: "REFUNDED",
          providerRef: null,
          // Leg index, not just method: two cash legs must not collide.
          idempotencyKey: `${input.key}:refund:${a.method}:${legIndex}`,
        });
      }
      if (cashMinor > 0 && sale.registerId) {
        await this.shifts.postCashSale(businessId, actorId, requestId, sale.registerId, sale.id, cashMinor, {
          type: "cash_refund",
          referenceType: "Refund",
          referenceId: refund.id,
        });
      }
      const allLines = await this.db.listSaleItems(sale.id, businessId);
      const allRefunded = await this.db.listRefundItemsBySale(sale.id, businessId);
      const refundedTotals = new Map<string, number>();
      for (const ri of allRefunded) {
        refundedTotals.set(ri.saleItemId, (refundedTotals.get(ri.saleItemId) ?? 0) + ri.qty);
      }
      const fully = allLines.every((l) => (refundedTotals.get(l.id) ?? 0) >= l.qty);
      const target = fully ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const status = transitionSale(sale.status, target);
      const updated =
        (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
      await this.db.claimIdempotency({
        businessId,
        key: input.key,
        commandType: "refund.approve",
        fingerprint,
        resultId: refund.id,
      });
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "refund.approve",
        entityType: "Refund",
        entityId: refund.id,
        requestId,
        ...(approval ? { after: { approval } } : {}),
      });
      if (singleStep) {
        await this.db.appendAudit({
          businessId,
          actorId,
          action: "refund.request",
          entityType: "Sale",
          entityId: sale.id,
          requestId,
        });
      }
      return { refund, sale: updated, replayed: false };
    });
  }

  async rejectRefund(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    reason: string,
    granted: string[],
  ): Promise<DbSale> {
    withScope(businessId, {});
    if (!granted.includes("sale.refund")) throw new Error("FORBIDDEN");
    if (!reason || reason.trim().length < 3) throw new Error("VALIDATION");
    return this.db.withLock(refundLockKey(businessId, saleId), async () => {
      const sale = await this.requireSale(businessId, saleId);
      if (sale.status !== "REFUND_REQUESTED") throw new Error("SALE_INVALID_TRANSITION");
      const status = transitionSale(sale.status, "COMPLETED");
      const updated = (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "refund.reject",
        entityType: "Sale",
        entityId: sale.id,
        requestId,
      });
      return updated;
    });
  }
}

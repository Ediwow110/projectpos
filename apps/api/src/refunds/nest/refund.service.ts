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
import { StoredValueService } from "../../value/stored-value.service";
import { normalizeRefundRequests } from "../refund-normalization";
import { JournalPostingService } from "../../accounting/journal-posting.service";
import { buildRefundDraft } from "../../accounting/journal-rules";

export interface RefundItemInput {
  saleItemId: string;
  qty: number;
}

export interface GiftCardLoadRefundInput {
  loadId: string;
  amountMinor: number;
}

const CASH_METHODS = new Set(["cash"]);

@Injectable()
export class RefundService {
  private readonly shifts: ShiftService;
  private readonly storedValue: StoredValueService;
  private readonly journals: JournalPostingService;

  constructor(@Inject("DbPort") private readonly db: DbPort) {
    // Same-DbPort instance (not Nest DI) to avoid a Refund<->Shift DI cycle.
    this.shifts = new ShiftService(db);
    this.storedValue = new StoredValueService(db);
    this.journals = new JournalPostingService(db);
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
    input: {
      items: RefundItemInput[];
      loadRefunds?: GiftCardLoadRefundInput[];
      deliveryRefundMinor?: number;
      reason?: string;
      destination?: "ORIGINAL_TENDER" | "STORE_CREDIT";
      key: string;
    },
    granted: string[],
    role: string,
    approval?: AppliedManagerApproval,
  ): Promise<{ refund: DbRefund; sale: DbSale; replayed: boolean }> {
    withScope(businessId, {});
    if (!granted.includes("sale.refund")) throw new Error("FORBIDDEN");
    return this.db.withLock(refundLockKey(businessId, saleId), async () => this.db.withTransaction(async () => {
      const { items: requestedItems, loadRefunds: normalizedLoads } = normalizeRefundRequests(input);
      const requestedDeliveryRefundMinor = input.deliveryRefundMinor ?? 0;
      if (!Number.isInteger(requestedDeliveryRefundMinor) || requestedDeliveryRefundMinor < 0) {
        throw new Error("VALIDATION");
      }
      const destination = input.destination ?? "ORIGINAL_TENDER";
      const fingerprint = fingerprintPayload({
        saleId,
        items: requestedItems,
        loadRefunds: normalizedLoads,
        deliveryRefundMinor: requestedDeliveryRefundMinor,
        reason: input.reason ?? null,
        destination,
      });
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
      const loads = await this.db.listSaleGiftCardLoads(sale.id, businessId);
      const priorRefunds = (await this.db.listRefundsBySale(sale.id, businessId)).filter(
        (row) => row.status === "APPROVED",
      );
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
      const resolvedLoadRows: Array<{ load: (typeof loads)[number]; amountMinor: number }> = [];
      for (const req of normalizedLoads) {
        const load = loads.find((row) => row.id === req.loadId);
        if (!load || !load.giftCardId) throw new Error("VALIDATION");
        const transactions = await this.db.listGiftCardTransactions(load.giftCardId, businessId);
        const refunded = transactions.filter((row) => row.type === "LOAD_REFUND" && row.loadId === load.id)
          .reduce((sum, row) => sum + Math.abs(row.amountDeltaMinor), 0);
        const balance = transactions.reduce((sum, row) => sum + row.amountDeltaMinor, 0);
        if (req.amountMinor > load.amountMinor - refunded) throw new Error("REFUND_EXCEEDS_LIMIT");
        if (req.amountMinor > balance) throw new Error("GIFT_CARD_LOAD_SPENT");
        resolvedLoadRows.push({ load, amountMinor: req.amountMinor });
      }
      if (resolvedLoadRows.length > 0 && destination !== "ORIGINAL_TENDER") throw new Error("GIFT_CARD_LOAD_ORIGINAL_TENDER_ONLY");
      const alreadyDeliveryFeeRefunded = priorRefunds.reduce(
        (sum, row) => sum + row.deliveryFeeRefundMinor,
        0,
      );
      const alreadyDeliveryTaxRefunded = priorRefunds.reduce(
        (sum, row) => sum + row.deliveryTaxRefundMinor,
        0,
      );
      let deliveryFeeRefundMinor = 0;
      let deliveryTaxRefundMinor = 0;
      if (requestedDeliveryRefundMinor > 0) {
        const remainingFee = Math.max(0, sale.deliveryFeeMinor - alreadyDeliveryFeeRefunded);
        const remainingTax = Math.max(0, sale.deliveryTaxMinor - alreadyDeliveryTaxRefunded);
        const remainingDelivery = remainingFee + remainingTax;
        if (remainingDelivery <= 0 || requestedDeliveryRefundMinor > remainingDelivery) {
          throw new Error("REFUND_EXCEEDS_LIMIT");
        }
        if (requestedDeliveryRefundMinor !== remainingDelivery) throw new Error("VALIDATION");
        deliveryFeeRefundMinor = remainingFee;
        deliveryTaxRefundMinor = remainingTax;
      }
      const merchandiseTotalMinor = resolved.reduce((sum, r) => sum + r.amount, 0);
      const loadRefundTotalMinor = resolvedLoadRows.reduce((sum, row) => sum + row.amountMinor, 0);
      const deliveryRefundTotalMinor = deliveryFeeRefundMinor + deliveryTaxRefundMinor;
      const totalMinor = merchandiseTotalMinor + loadRefundTotalMinor + deliveryRefundTotalMinor;
      if (totalMinor <= 0) throw new Error("VALIDATION");
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
      let priorTenderConsumption = priorRefunds.reduce((sum, row) => sum + row.totalMinor, 0);
      const allocations: Array<{ method: string; amount: number; internalInstrumentType?: "gift_card" | "store_credit" | "loyalty"; internalInstrumentId?: string }> = [];
      if (destination === "STORE_CREDIT") {
        if (!sale.customerId) throw new Error("CUSTOMER_REQUIRED");
        const account = await this.storedValue.ensureStoreCreditAccount(businessId, sale.customerId);
        allocations.push({ method: "store_credit", amount: totalMinor, internalInstrumentType: "store_credit", internalInstrumentId: account.id });
        remaining = 0;
      }
      for (const p of succeeded) {
        if (destination === "STORE_CREDIT") break;
        if (remaining <= 0) break;
        const previouslyConsumed = Math.min(priorTenderConsumption, p.amountMinor);
        priorTenderConsumption -= previouslyConsumed;
        const available = p.amountMinor - previouslyConsumed;
        if (available <= 0) continue;
        const portion = Math.min(remaining, available);
        allocations.push({ method: p.method, amount: portion, internalInstrumentType: p.internalInstrumentType ?? undefined, internalInstrumentId: p.internalInstrumentId ?? undefined });
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
        deliveryFeeRefundMinor,
        deliveryTaxRefundMinor,
        reason,
        requestedBy: singleStep ? actorId : ((await this.findRequester(businessId, saleId)) ?? actorId),
        approvedBy: actorId,
        requestId,
        approvedRequestId: requestId,
        singleStep,
      });
      const resolvedWithTracking = await Promise.all(
        resolved.map(async (row) => {
          const product = await this.db.findProductById(row.line.productId, businessId);
          const bundleComponents = await this.db.listSaleItemBundleComponents(row.line.id, businessId);
          if (product?.productType === "BUNDLE" && bundleComponents.length === 0) throw new Error("INVALID_BUNDLE_SNAPSHOT");
          if (bundleComponents.some((component) => !Number.isInteger(component.quantityPerBundleSnapshot) || component.quantityPerBundleSnapshot <= 0)) throw new Error("INVALID_BUNDLE_SNAPSHOT");
          return { ...row, tracked: product?.trackInventory === true, bundleComponents };
        }),
      );
      const saleLoyalty = await this.db.findSaleLoyalty(sale.id, businessId);
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
          internalInstrumentType: a.internalInstrumentType ?? null,
          internalInstrumentId: a.internalInstrumentId ?? null,
          // Leg index, not just method: two cash legs must not collide.
          idempotencyKey: `${input.key}:refund:${a.method}:${legIndex}`,
        });
      }
      for (const [legIndex, a] of allocations.entries()) {
        const ledgerKey = `${input.key}:refund-ledger:${legIndex}`;
        if (a.internalInstrumentType === "gift_card" && a.internalInstrumentId) {
          await this.db.createGiftCardTransaction({ businessId, giftCardId: a.internalInstrumentId, type: "REFUND", amountDeltaMinor: a.amount, saleId: sale.id, refundId: refund.id, actorId, requestId, idempotencyKey: ledgerKey, reason: reason ?? "Refund", branchId: sale.branchId ?? null });
        } else if (a.internalInstrumentType === "store_credit" && a.internalInstrumentId) {
          const account = await this.db.findStoreCreditAccount(sale.customerId ?? "", businessId);
          if (!account) throw new Error("NOT_FOUND");
          await this.db.createStoreCreditTransaction({ businessId, accountId: account.id, customerId: sale.customerId!, type: "REFUND", amountDeltaMinor: a.amount, saleId: sale.id, refundId: refund.id, actorId, requestId, idempotencyKey: ledgerKey, reason: reason ?? "Refund", branchId: sale.branchId ?? null });
        } else if (a.internalInstrumentType === "loyalty" && a.internalInstrumentId) {
          const account = await this.db.findLoyaltyAccount(sale.customerId ?? "", businessId);
          if (!account) throw new Error("NOT_FOUND");
          const program = await this.db.getLoyaltyProgram(businessId);
          if (!program) throw new Error("LOYALTY_DISABLED");
          const points = Math.floor(a.amount * (saleLoyalty?.redeemPointsSnapshot ?? program.redeemPoints) / (saleLoyalty?.redeemValueMinorSnapshot ?? program.redeemValueMinor));
          if (points > 0) await this.db.createLoyaltyTransaction({ businessId, accountId: account.id, customerId: sale.customerId!, type: "REFUND_REDEEM", pointsDelta: points, valueMinorSnapshot: a.amount, saleId: sale.id, refundId: refund.id, actorId, requestId, idempotencyKey: ledgerKey, reason: reason ?? "Refund" });
        }
      }
      for (const row of resolvedLoadRows) {
        await this.db.createGiftCardTransaction({
          businessId,
          giftCardId: row.load.giftCardId!,
          type: "LOAD_REFUND",
          amountDeltaMinor: -row.amountMinor,
          saleId: sale.id,
          refundId: refund.id,
          loadId: row.load.id,
          actorId,
          requestId,
          idempotencyKey: `${input.key}:load-refund:${row.load.id}`,
          reason: reason ?? "Gift-card load refund",
          branchId: sale.branchId ?? null,
        });
      }
      let loyaltyLiabilityMinor = 0;
      if (merchandiseTotalMinor > 0 && saleLoyalty && saleLoyalty.earnedPoints > 0 && saleLoyalty.eligibleSpendMinor > 0) {
        const itemAllocations = await this.db.listSaleItemLoyaltyAllocations(saleLoyalty.id, businessId);
        const resolvedByLine = new Map(resolved.map((row) => [row.line.id, row]));
        const allocatedReversal = itemAllocations.reduce((sum, allocation) => {
          const row = resolvedByLine.get(allocation.saleItemId);
          if (!row) return sum;
          const priorQty = refundedByLine.get(row.line.id) ?? 0;
          const before = Math.floor(allocation.earnedPoints * priorQty / Math.max(1, row.line.qty));
          const after = Math.floor(allocation.earnedPoints * (priorQty + row.qty) / Math.max(1, row.line.qty));
          return sum + Math.max(0, after - before);
        }, 0);
        const reversal = itemAllocations.length > 0
          ? Math.min(saleLoyalty.earnedPoints, allocatedReversal)
          : Math.min(saleLoyalty.earnedPoints, Math.floor(saleLoyalty.earnedPoints * merchandiseTotalMinor / saleLoyalty.eligibleSpendMinor));
        if (reversal > 0) {
          loyaltyLiabilityMinor = Math.floor(reversal * saleLoyalty.redeemValueMinorSnapshot / saleLoyalty.redeemPointsSnapshot);
          const account = await this.db.findLoyaltyAccount(saleLoyalty.customerId, businessId);
          if (account) await this.db.createLoyaltyTransaction({ businessId, accountId: account.id, customerId: saleLoyalty.customerId, type: "REFUND_EARN_REVERSAL", pointsDelta: -reversal, valueMinorSnapshot: totalMinor, saleId: sale.id, refundId: refund.id, actorId, requestId, idempotencyKey: `${input.key}:refund-earn`, reason: reason ?? "Refund" });
        }
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
      const fully = allLines.length > 0 && allLines.every((l) => (refundedTotals.get(l.id) ?? 0) >= l.qty);
      const allApprovedRefunds = (await this.db.listRefundsBySale(sale.id, businessId)).filter(
        (row) => row.status === "APPROVED",
      );
      const deliveryFullyRefunded =
        allApprovedRefunds.reduce((sum, row) => sum + row.deliveryFeeRefundMinor, 0) >= sale.deliveryFeeMinor
        && allApprovedRefunds.reduce((sum, row) => sum + row.deliveryTaxRefundMinor, 0) >= sale.deliveryTaxMinor;
      const target = fully && deliveryFullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const status = transitionSale(sale.status, target);
      const updated =
        (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
      const business = await this.db.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
      const restockedCostMinor = resolvedWithTracking.reduce((sum, row) =>
        sum + (row.tracked || row.bundleComponents.length > 0 ? row.line.costMinor * row.qty : 0), 0);
      await this.journals.postSourceEvent({
        businessId, branchId: sale.branchId ?? null, sourceType: "Refund", sourceId: refund.id, sourceEvent: "approved", actorId, requestId,
        draft: buildRefundDraft({
          currency: business.currency, effectiveAt: new Date(),
          tenders: allocations.map(({ method, amount }) => ({ method, amountMinor: amount })),
          merchandiseRevenueMinor: merchandiseTotalMinor, deliveryRevenueMinor: deliveryFeeRefundMinor,
          taxPayableMinor: deliveryTaxRefundMinor, giftCardLiabilityMinor: loadRefundTotalMinor,
          loyaltyLiabilityMinor,
          restockedCostMinor,
        }),
      });
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
    }));
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

import { Inject, Injectable } from "@nestjs/common";
import type { DbCustomerConcern, DbCustomerConcernItem, DbPort } from "../../common/db.port";

const ACTIVE_CASE_STATES = new Set(["PENDING", "OWNER_REVIEW", "APPROVED"]);
const REASONS = new Set(["DAMAGED", "DEFECTIVE", "WRONG_ITEM", "MISSING_PARTS", "QUALITY", "OTHER"]);
const OUTCOMES = new Set(["REFUND", "EXCHANGE"]);

export interface CustomerConcernInput {
  saleId: string;
  items: Array<{ saleItemId: string; qty: number }>;
  reason: string;
  outcome: string;
  note?: string;
}

export interface CustomerConcernActorScope {
  activeBranchId?: string | null;
  allowedBranchIds?: readonly string[] | null;
  allowedRegisterIds?: readonly string[] | null;
}

function assertConcernScope(branchId: string | null, registerId: string | null, scope: CustomerConcernActorScope): void {
  if (scope.activeBranchId && branchId !== scope.activeBranchId) throw new Error("FORBIDDEN");
  if (scope.allowedBranchIds != null && (!branchId || !scope.allowedBranchIds.includes(branchId))) throw new Error("FORBIDDEN");
  if (scope.allowedRegisterIds != null && (!registerId || !scope.allowedRegisterIds.includes(registerId))) throw new Error("FORBIDDEN");
}

@Injectable()
export class CustomerConcernService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async submit(businessId: string, actorId: string, requestId: string, idempotencyKey: string, input: CustomerConcernInput, scope: CustomerConcernActorScope = {}) {
    if (!input || typeof input !== "object" || typeof input.saleId !== "string" || !input.saleId ||
      !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20 ||
      typeof input.reason !== "string" || !REASONS.has(input.reason) || typeof input.outcome !== "string" || !OUTCOMES.has(input.outcome) ||
      (input.note !== undefined && typeof input.note !== "string") || (input.note?.length ?? 0) > 500 ||
      !idempotencyKey || idempotencyKey.length > 128 ||
      input.items.some((item) => !item.saleItemId || !Number.isSafeInteger(item.qty) || item.qty <= 0) ||
      new Set(input.items.map((item) => item.saleItemId)).size !== input.items.length) throw new Error("VALIDATION");

    return this.db.withLock(`customer-concern:${businessId}`, async () => this.db.withTransaction(async (tx) => {
      const prior = await tx.findCustomerConcernByIdempotency(businessId, idempotencyKey);
      if (prior) {
        if (prior.requesterId !== actorId) throw new Error("FORBIDDEN");
        assertConcernScope(prior.branchId, prior.registerId, scope);
        const same = prior.saleId === input.saleId && prior.reason === input.reason && prior.outcome === input.outcome &&
          prior.note === (input.note?.trim() || null) && JSON.stringify(prior.items.map(({ saleItemId, qty }) => ({ saleItemId, qty })).sort((a, b) => a.saleItemId.localeCompare(b.saleItemId))) ===
          JSON.stringify([...input.items].sort((a, b) => a.saleItemId.localeCompare(b.saleItemId)));
        if (!same) throw new Error("IDEMPOTENCY_MISMATCH");
        return { concern: prior, replayed: true };
      }
      const sale = await tx.findSaleById(input.saleId, businessId);
      if (!sale) throw new Error("NOT_FOUND");
      assertConcernScope(sale.branchId ?? null, sale.registerId ?? null, scope);
      if ((sale.status !== "COMPLETED" && sale.status !== "PARTIALLY_REFUNDED") || sale.paidMinor < sale.totalMinor) {
        throw new Error("SALE_NOT_RETURNABLE");
      }
      const saleItems = await tx.listSaleItems(sale.id, businessId);
      const refundItems = await tx.listRefundItemsBySale(sale.id, businessId);
      const priorCases = (await tx.listCustomerConcernsByBusiness(businessId)).filter((row) => row.saleId === sale.id && ACTIVE_CASE_STATES.has(row.status));
      const snapshots: DbCustomerConcernItem[] = [];
      let amountMinor = 0;
      for (const requested of input.items) {
        const line = saleItems.find((item) => item.id === requested.saleItemId);
        if (!line) throw new Error("VALIDATION");
        const alreadyRefunded = refundItems.filter((item) => item.saleItemId === line.id).reduce((sum, item) => sum + item.qty, 0);
        const reserved = priorCases.flatMap((row) => row.items).filter((item) => item.saleItemId === line.id).reduce((sum, item) => sum + item.qty, 0);
        if (requested.qty > line.qty - alreadyRefunded - reserved) throw new Error("RETURN_EXCEEDS_RETURNABLE");
        const lineAmount = Math.floor((line.lineTotalMinor * requested.qty) / line.qty);
        amountMinor += lineAmount;
        snapshots.push({ saleItemId: line.id, name: line.name, qty: requested.qty, amountMinor: lineAmount });
      }
      if (amountMinor <= 0) throw new Error("VALIDATION");
      const threshold = (await tx.getSettings(businessId))["refundApprovalThresholdMinor"];
      const status = typeof threshold === "number" && amountMinor > threshold ? "OWNER_REVIEW" : "PENDING";
      const concern = await tx.createCustomerConcern({
        businessId, saleId: sale.id, receiptNo: sale.receiptNo, branchId: sale.branchId ?? null,
        registerId: sale.registerId ?? null, requesterId: actorId, reason: input.reason, outcome: input.outcome,
        note: input.note?.trim() || null, items: snapshots, requestedRefundMinor: amountMinor, status,
        idempotencyKey, reviewedBy: null, reviewedAt: null, reviewReason: null, refundId: null,
      });
      await tx.appendAudit({ businessId, actorId, action: "customer_concern.request", entityType: "CustomerConcern", entityId: concern.id, requestId,
        after: { saleId: sale.id, outcome: concern.outcome, status, requestedRefundMinor: amountMinor, itemCount: snapshots.length } });
      return { concern, replayed: false };
    }));
  }

  async list(businessId: string): Promise<DbCustomerConcern[]> {
    return this.db.listCustomerConcernsByBusiness(businessId);
  }

  async find(businessId: string, id: string): Promise<DbCustomerConcern> {
    const row = await this.db.findCustomerConcernById(id, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  }

  async decide(businessId: string, actorId: string, requestId: string, id: string, decision: "APPROVED" | "REJECTED", reason: string, isOwner: boolean) {
    if (!reason.trim() || reason.trim().length < 3 || reason.length > 300) throw new Error("VALIDATION");
    return this.db.withLock(`customer-concern-review:${businessId}:${id}`, async () => this.db.withTransaction(async (tx) => {
      const row = await tx.findCustomerConcernById(id, businessId);
      if (!row) throw new Error("NOT_FOUND");
      if (row.status === "OWNER_REVIEW" && !isOwner) throw new Error("FORBIDDEN");
      if (row.status !== "PENDING" && row.status !== "OWNER_REVIEW") throw new Error("INVALID_STATE");
      const threshold = (await tx.getSettings(businessId))["refundApprovalThresholdMinor"];
      if (!isOwner && typeof threshold === "number" && row.requestedRefundMinor > threshold) {
        if (row.status === "PENDING") {
          const escalated = await tx.transitionCustomerConcern(id, businessId, row.status, { status: "OWNER_REVIEW" });
          if (!escalated) throw new Error("INVALID_STATE");
          await tx.appendAudit({ businessId, actorId, action: "customer_concern.owner_escalated", entityType: "CustomerConcern", entityId: id, requestId,
            reason: "refund_threshold_changed", before: { status: row.status }, after: { status: "OWNER_REVIEW" } });
          return escalated;
        }
        throw new Error("FORBIDDEN");
      }
      const updated = await tx.transitionCustomerConcern(id, businessId, row.status, {
        status: decision, reviewedBy: actorId, reviewedAt: new Date(), reviewReason: reason.trim(),
      });
      if (!updated) throw new Error("INVALID_STATE");
      await tx.appendAudit({ businessId, actorId, action: decision === "APPROVED" ? "customer_concern.approve" : "customer_concern.reject",
        entityType: "CustomerConcern", entityId: id, requestId, reason: reason.trim(), before: { status: row.status }, after: { status: decision } });
      return updated;
    }));
  }
}

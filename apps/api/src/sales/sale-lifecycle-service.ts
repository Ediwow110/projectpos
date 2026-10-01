import type { DbPort, DbSale } from "../common/db.port";
import { fingerprintPayload } from "./idempotency";
import { transitionSale } from "./state-machine";
import { refundLockKey } from "../refunds/refund-lock";
import type { AppliedManagerApproval } from "../auth/nest/manager-approval-policy.service";

export class SalesLifecycleService {
  constructor(private readonly db: DbPort) {}

  private async requireSale(businessId: string, saleId: string): Promise<DbSale> {
    const sale = await this.db.findSaleById(saleId, businessId);
    if (!sale) throw new Error("NOT_FOUND");
    return sale;
  }

  async holdSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
  ): Promise<{ id: string }> {
    const sale = await this.requireSale(businessId, saleId);
    if (sale.status !== "DRAFT") throw new Error("SALE_INVALID_TRANSITION");
    if (sale.actorId !== actorId) throw new Error("FORBIDDEN");
    const held = await this.db.createHeldSale({
      businessId,
      actorId,
      payload: { saleId: sale.id },
      resumedAt: null,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "sale.hold",
      entityType: "Sale",
      entityId: sale.id,
      requestId,
    });
    return { id: held.id };
  }

  async resumeSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
  ): Promise<DbSale> {
    const sale = await this.requireSale(businessId, saleId);
    if (sale.status !== "DRAFT") throw new Error("SALE_INVALID_TRANSITION");
    if (sale.actorId !== actorId) throw new Error("FORBIDDEN");
    const heldList = await this.db.listHeldSales(businessId, actorId);
    const held = heldList.find(
      (row) =>
        (row.payload as { saleId?: string } | null)?.saleId === saleId &&
        row.resumedAt === null,
    );
    if (!held) throw new Error("NOT_FOUND");
    await this.db.markHeldResumed(held.id, businessId);
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "sale.resume",
      entityType: "Sale",
      entityId: sale.id,
      requestId,
    });
    return sale;
  }

  async voidSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    reason: string,
    granted: string[],
    approval?: AppliedManagerApproval,
  ): Promise<DbSale> {
    if (!granted.includes("sale.void")) throw new Error("FORBIDDEN");
    if (!reason || reason.trim().length < 3) throw new Error("VALIDATION");
    return this.db.withLock(`sales:${businessId}`, async () => {
      const sale = await this.requireSale(businessId, saleId);
      if (sale.status === "COMPLETED") throw new Error("SALE_INVALID_TRANSITION");
      const status = transitionSale(sale.status, "VOIDED");
      const updated =
        (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "sale.void",
        entityType: "Sale",
        entityId: sale.id,
        requestId,
        ...(approval ? { after: { approval } } : {}),
      });
      return updated;
    });
  }

  async requestRefund(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    reason: string,
    key: string,
    granted: string[],
  ): Promise<DbSale> {
    if (!granted.includes("sale.refund")) throw new Error("FORBIDDEN");
    if (!reason || reason.trim().length < 3) throw new Error("VALIDATION");
    return this.db.withLock(refundLockKey(businessId, saleId), async () => {
      const fingerprint = fingerprintPayload({ saleId, reason });
      const existing = await this.db.findIdempotency(
        businessId,
        key,
        "refund.request",
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new Error("IDEMPOTENCY_MISMATCH");
        }
        return this.requireSale(businessId, existing.resultId);
      }
      const sale = await this.requireSale(businessId, saleId);
      if (sale.status !== "COMPLETED") throw new Error("SALE_INVALID_TRANSITION");
      const status = transitionSale(sale.status, "REFUND_REQUESTED");
      const updated =
        (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
      await this.db.claimIdempotency({
        businessId,
        key,
        commandType: "refund.request",
        fingerprint,
        resultId: sale.id,
      });
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "refund.request",
        entityType: "Sale",
        entityId: sale.id,
        requestId,
      });
      return updated;
    });
  }
}

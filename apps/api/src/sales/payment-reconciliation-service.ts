import type { DbPayment, DbPort, DbSale, DbSaleItem } from "../common/db.port";
import { OrderSaleService } from "../orders/order-sale-service";
import { OrderNotificationService } from "../orders/order-notification-service";
import { fingerprintPayload } from "./idempotency";
import { transitionSale } from "./state-machine";

type EmbeddedSale = DbSale & {
  items: DbSaleItem[];
  payments: DbPayment[];
};

interface ReconciliationOps {
  requireSale: (businessId: string, saleId: string) => Promise<DbSale>;
  embedSale: (sale: DbSale) => Promise<EmbeddedSale>;
  applyStockEffect: (
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    items: DbSaleItem[],
    branchId: string | null,
    ownerOrderId?: string,
  ) => Promise<void>;
  postCashSale: (
    businessId: string,
    actorId: string,
    requestId: string,
    registerId: string,
    saleId: string,
    amountMinor: number,
  ) => Promise<void>;
  recordSale: (businessId: string, completedAt: Date) => Promise<void>;
}

const CASH_METHODS = new Set(["cash"]);

export class SalesPaymentReconciliationService {
  private readonly orderSales: OrderSaleService;

  constructor(
    private readonly db: DbPort,
    private readonly ops: ReconciliationOps,
    private readonly notifications?: OrderNotificationService,
  ) {
    this.orderSales = new OrderSaleService(db);
  }

  async reconcilePayment(
    businessId: string,
    actorId: string,
    requestId: string,
    paymentId: string,
    outcome: "SUCCEEDED" | "FAILED",
    key: string,
  ): Promise<{ sale: EmbeddedSale; payment: DbPayment }> {
    const result = await this.db.withLock(`sales:${businessId}`, async () => this.db.withTransaction(async () => {
      const fingerprint = fingerprintPayload({ paymentId, outcome });
      const existing = await this.db.findIdempotency(businessId, key, "payment.reconcile");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const payment = await this.db.findPaymentById(paymentId, businessId);
        if (!payment) throw new Error("NOT_FOUND");
        const sale = await this.ops.requireSale(businessId, payment.saleId);
        return { sale: await this.ops.embedSale(sale), payment, confirmedOrderId: null as string | null };
      }

      const payment = await this.db.findPaymentById(paymentId, businessId);
      if (!payment) throw new Error("NOT_FOUND");
      if (payment.status !== "UNKNOWN") throw new Error("SALE_INVALID_TRANSITION");
      const sale = await this.ops.requireSale(businessId, payment.saleId);
      if (sale.status !== "PAYMENT_UNKNOWN") throw new Error("SALE_INVALID_TRANSITION");

      const updatedPayment =
        (await this.db.updatePayment(payment.id, businessId, {
          status: outcome === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
        })) ?? payment;
      await this.db.claimIdempotency({
        businessId,
        key,
        commandType: "payment.reconcile",
        fingerprint,
        resultId: payment.id,
      });
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "payment.reconcile",
        entityType: "Payment",
        entityId: payment.id,
        requestId,
      });

      const legs = await this.db.listPaymentsBySale(sale.id, businessId);
      if (legs.some((leg) => leg.status === "UNKNOWN")) {
        return { sale: await this.ops.embedSale(sale), payment: updatedPayment, confirmedOrderId: null as string | null };
      }

      const succeeded = legs
        .filter((leg) => leg.status === "SUCCEEDED")
        .reduce((sum, leg) => sum + leg.amountMinor, 0);
      const anyFailed = legs.some((leg) => leg.status === "FAILED");
      if (anyFailed || succeeded < sale.totalMinor) {
        const failed = transitionSale(transitionSale(sale.status, "RECONCILED"), "PENDING_PAYMENT");
        const failedSale =
          (await this.db.updateSale(sale.id, businessId, {
            status: transitionSale(failed, "PAYMENT_FAILED"),
          })) ?? sale;
        return { sale: await this.ops.embedSale(failedSale), payment: updatedPayment, confirmedOrderId: null as string | null };
      }

      const items = await this.db.listSaleItems(sale.id, businessId);
      const linkedOrder = await this.db.findOrderBySaleId(sale.id, businessId);
      const shouldNotify = linkedOrder?.channel === "WEB" && linkedOrder.status === "SUBMITTED";
      await this.ops.applyStockEffect(
        businessId,
        actorId,
        requestId,
        sale.id,
        items,
        sale.branchId ?? null,
        linkedOrder?.id,
      );
      const cashMinor = legs
        .filter((leg) => leg.status === "SUCCEEDED" && CASH_METHODS.has(leg.method))
        .reduce((sum, leg) => sum + leg.amountMinor, 0);
      if (sale.registerId && cashMinor > 0) {
        const open = await this.db.findOpenShiftByRegister(businessId, sale.registerId);
        if (!open) throw new Error("SHIFT_NO_OPEN_SHIFT");
        await this.ops.postCashSale(
          businessId,
          actorId,
          requestId,
          sale.registerId,
          sale.id,
          Math.max(0, cashMinor - sale.changeMinor),
        );
      }

      let status = transitionSale(sale.status, "RECONCILED");
      status = transitionSale(status, "PENDING_PAYMENT");
      status = transitionSale(status, "PAID");
      status = transitionSale(status, "COMPLETED");
      const completedAt = new Date();
      const updated =
        (await this.db.updateSale(sale.id, businessId, { status, completedAt })) ?? sale;
      await this.orderSales.settleLinkedSaleLocked(this.db, businessId, sale.id, completedAt);
      await this.ops.recordSale(businessId, completedAt);
      return { sale: await this.ops.embedSale(updated), payment: updatedPayment, confirmedOrderId: shouldNotify ? linkedOrder!.id : null };
    }));
    if (result.confirmedOrderId && this.notifications) {
      await this.notifications.sendEvent(businessId, result.confirmedOrderId, "CONFIRMED");
    }
    return { sale: result.sale, payment: result.payment };
  }
}

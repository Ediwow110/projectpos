import type { DbPayment, DbPort, DbSale, DbSaleItem } from "../common/db.port";
import type { ProviderVerdict } from "../payments/provider";
import { isPayMongoMethod } from "../payments/paymongo";
import { OrderSaleService } from "../orders/order-sale-service";
import { OrderNotificationService } from "../orders/order-notification-service";
import { fingerprintPayload } from "./idempotency";
import { transitionSale } from "./state-machine";
import { recordIdempotencyConflict, recordPaymentHandoff, recordSaleChannel } from "../common/metrics";

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

/**
 * The provider verdict probe. A reconcile that claims success for a hosted
 * method is only a claim: the provider decides. Kept as a narrow port so this
 * service does not depend on the whole provider service.
 */
export interface PaymentVerdictProbe {
  queryProvider(
    businessId: string,
    paymentId: string,
    provider?: string,
  ): Promise<{ status: ProviderVerdict }>;
}

export class SalesPaymentReconciliationService {
  private readonly orderSales: OrderSaleService;

  constructor(
    private readonly db: DbPort,
    private readonly ops: ReconciliationOps,
    private readonly provider: PaymentVerdictProbe,
    private readonly notifications?: OrderNotificationService,
  ) {
    this.orderSales = new OrderSaleService(db);
  }

  /**
   * Resolve what the ledger may actually be told about a payment.
   *
   * A client asserting SUCCEEDED for a hosted method is not evidence: that is
   * exactly the claim a browser can make about money it never saw move. The
   * provider is asked first, and its verdict outranks the request - including
   * downward to FAILED. When the provider cannot answer, nothing is written:
   * the leg stays UNKNOWN and can be reconciled again, rather than being
   * completed on an unverified promise.
   *
   * Runs before the lock and transaction so a provider round-trip never holds
   * a database transaction open.
   */
  private async settleOutcome(
    businessId: string,
    paymentId: string,
    claimed: "SUCCEEDED" | "FAILED",
  ): Promise<"SUCCEEDED" | "FAILED"> {
    if (claimed !== "SUCCEEDED") return claimed;
    const payment = await this.db.findPaymentById(paymentId, businessId);
    if (!payment) throw new Error("NOT_FOUND");
    if (!isPayMongoMethod(payment.method)) return claimed;
    // Resolve the verdict through the same adapter the provider-status endpoint
    // uses: a PayMongo checkout session is queried at PayMongo, anything else
    // through the double keyed by (business, reference). Nothing is registered
    // for a double in production, so an unverifiable reference answers UNKNOWN
    // and the leg stays unresolved - the safe direction for money.
    const provider = (payment.providerRef ?? "").startsWith("cs_") ? "paymongo" : "test-double";
    const verdict = await this.provider.queryProvider(businessId, paymentId, provider);
    if (verdict.status === "SUCCEEDED") return "SUCCEEDED";
    if (verdict.status === "FAILED") return "FAILED";
    throw new Error("PAYMENT_UNKNOWN");
  }

  async reconcilePayment(
    businessId: string,
    actorId: string,
    requestId: string,
    paymentId: string,
    outcome: "SUCCEEDED" | "FAILED",
    key: string,
  ): Promise<{ sale: EmbeddedSale; payment: DbPayment }> {
    const settled = await this.settleOutcome(businessId, paymentId, outcome);
    const result = await this.db.withLock(`sales:${businessId}`, async () => this.db.withTransaction(async () => {
      const fingerprint = fingerprintPayload({ paymentId, outcome: settled });
      const existing = await this.db.findIdempotency(businessId, key, "payment.reconcile");
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          recordIdempotencyConflict("payment");
          throw new Error("IDEMPOTENCY_MISMATCH");
        }
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
          status: settled === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
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
        recordPaymentHandoff("reconciled");
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
      if (shouldNotify && this.notifications?.hasOutbox()) {
        await this.notifications.enqueueEvent(businessId, linkedOrder!.id, "CONFIRMED",
          "payment-reconcile:" + payment.id);
      }
      await this.ops.recordSale(businessId, completedAt);
      recordPaymentHandoff("reconciled");
      recordSaleChannel(linkedOrder?.channel === "WEB" ? "WEB" : "POS");
      return { sale: await this.ops.embedSale(updated), payment: updatedPayment, confirmedOrderId: shouldNotify ? linkedOrder!.id : null };
    }));
    if (result.confirmedOrderId && this.notifications && !this.notifications.hasOutbox()) {
      await this.notifications.sendEvent(businessId, result.confirmedOrderId, "CONFIRMED");
    }
    return { sale: result.sale, payment: result.payment };
  }
}

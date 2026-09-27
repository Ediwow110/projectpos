import type { DbPort } from "../common/db.port";
import { incrementMetric } from "../common/metrics";
import { BillingService } from "../billing/nest/billing.service";
import {
  isPayMongoMethod,
  payMongoMethodType,
  type PayMongoPort,
} from "../payments/paymongo";
import { parsePayMongoPaidEvent, type PayMongoPaidEvent } from "./paymongo-event";
import { SalesStockService } from "./sale-stock-service";
import { transitionSale } from "./state-machine";

export class SalesPayMongoWebhookService {
  private readonly billing: BillingService;

  constructor(
    private readonly db: DbPort,
    private readonly paymongo: PayMongoPort,
    private readonly stock: SalesStockService,
  ) {
    this.billing = new BillingService(db);
  }

  private async settlePaid(
    event: PayMongoPaidEvent,
    requestId: string,
  ): Promise<void> {
    await this.db.withLock(`sales:${event.businessId}`, async () => {
      const sale = await this.db.findSaleById(event.saleId, event.businessId);
      if (!sale) throw new Error("NOT_FOUND");
      const payments = await this.db.listPaymentsBySale(
        sale.id,
        event.businessId,
      );
      const payment =
        payments.find(
          (row) => row.providerRef === event.checkoutSessionId,
        ) ?? null;
      if (!payment || !isPayMongoMethod(payment.method)) {
        throw new Error("NOT_FOUND");
      }
      if (payment.method !== event.method) {
        throw new Error("PAYMENT_PROVIDER_MISMATCH");
      }
      if (event.sourceType !== payMongoMethodType(payment.method)) {
        throw new Error("PAYMENT_PROVIDER_MISMATCH");
      }
      if (
        event.amountMinor !== payment.amountMinor ||
        event.amountMinor !== sale.totalMinor
      ) {
        throw new Error("PAYMENT_TOTAL_MISMATCH");
      }
      if (sale.status === "COMPLETED" && payment.status === "SUCCEEDED") {
        return;
      }
      if (sale.status !== "PENDING_PAYMENT") {
        throw new Error("SALE_INVALID_TRANSITION");
      }
      if (payment.status !== "PENDING") {
        throw new Error("SALE_INVALID_TRANSITION");
      }

      const items = await this.db.listSaleItems(sale.id, event.businessId);
      await this.stock.applySale(
        event.businessId,
        "paymongo-webhook",
        requestId,
        sale.id,
        items,
        sale.branchId ?? null,
      );
      await this.db.updatePayment(payment.id, event.businessId, {
        status: "SUCCEEDED",
      });
      let status = transitionSale(sale.status, "PAID");
      status = transitionSale(status, "COMPLETED");
      const completedAt = new Date();
      await this.db.updateSale(sale.id, event.businessId, {
        status,
        paidMinor: sale.totalMinor,
        changeMinor: 0,
        completedAt,
      });
      await this.billing.recordSale(event.businessId, completedAt);
      await this.db.appendAudit({
        businessId: event.businessId,
        actorId: "paymongo-webhook",
        action: "payment.paymongo.paid",
        entityType: "Payment",
        entityId: payment.id,
        requestId,
      });
      incrementMetric("pos_sales_completed_total");
    });
  }

  async handle(
    rawBody: string,
    signatureHeader: string | undefined,
    payload: unknown,
    requestId: string,
  ): Promise<{ handled: boolean; deduplicated?: boolean }> {
    if (!this.paymongo.configured()) {
      throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
    if (!this.paymongo.verifyWebhook(rawBody, signatureHeader)) {
      throw new Error("FORBIDDEN");
    }
    const event = parsePayMongoPaidEvent(payload, rawBody);
    if (!event) return { handled: false };
    return this.db.withLock(`paymongo-webhook:${event.eventId}`, async () => {
      const claimed = await this.db.claimWebhookEvent({
        businessId: event.businessId,
        provider: "paymongo",
        eventId: event.eventId,
        type: event.type,
        payload,
        status: "processing",
      });
      if (!claimed) return { handled: true, deduplicated: true };
      try {
        await this.settlePaid(event, requestId);
        await this.db.updateWebhookEventStatus(claimed.id, "processed");
        return { handled: true };
      } catch (error) {
        await this.db.deleteWebhookEvent(claimed.id);
        throw error;
      }
    });
  }
}

import type { DbPayment, DbPort, DbSale, DbSaleItem } from "../common/db.port";
import { queryProviderStatus, type ProviderVerdict } from "../payments/provider";
import {
  isPayMongoMethod,
  type PayMongoMethod,
  type PayMongoPort,
} from "../payments/paymongo";
import { fingerprintPayload } from "./idempotency";
import { resolvePaymentMethods } from "./payment-methods";
import { transitionSale } from "./state-machine";
import { recordIdempotencyConflict, recordPaymentHandoff } from "../common/metrics";

type EmbeddedSale = DbSale & {
  items: DbSaleItem[];
  payments: DbPayment[];
};

interface PaymentProviderOps {
  requireSale: (businessId: string, saleId: string) => Promise<DbSale>;
  embedSale: (sale: DbSale) => Promise<EmbeddedSale>;
  assertStockAvailable: (
    businessId: string,
    items: DbSaleItem[],
    branchId: string | null,
    ownerOrderId?: string,
  ) => Promise<void>;
}

export class SalesPaymentProviderService {
  constructor(
    private readonly db: DbPort,
    private readonly paymongo: PayMongoPort,
    private readonly ops: PaymentProviderOps,
  ) {}

  async startPayMongoCheckout(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    method: PayMongoMethod,
    key: string,
    webUrl: string,
    returnPaths?: { successPath: string; cancelPath: string },
  ): Promise<{
    sale: EmbeddedSale;
    payment: DbPayment;
    checkoutUrl: string;
    checkoutSessionId: string;
    replayed: boolean;
  }> {
    if (!this.paymongo.configured()) throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
    return this.db.withLock(`sales:${businessId}`, async () => {
      let sale = await this.ops.requireSale(businessId, saleId);
      if (sale.status !== "DRAFT" && sale.status !== "PENDING_PAYMENT" && sale.status !== "PAYMENT_FAILED") {
        throw new Error("SALE_INVALID_TRANSITION");
      }
      const configuredMethods = new Set((await resolvePaymentMethods(this.db, businessId)).map((entry) => entry.key));
      if (!configuredMethods.has(method)) throw new Error("VALIDATION");
      const items = await this.db.listSaleItems(sale.id, businessId);
      if (items.length === 0) throw new Error("VALIDATION");
      const ownerOrder = await this.db.findOrderBySaleId(sale.id, businessId);
      await this.ops.assertStockAvailable(businessId, items, sale.branchId ?? null, ownerOrder?.id);

      const fingerprint = fingerprintPayload({ saleId, method });
      const existingKey = await this.db.findIdempotency(businessId, key, "paymongo.checkout");
      if (existingKey) {
        if (existingKey.fingerprint !== fingerprint) {
          recordIdempotencyConflict("payment");
          throw new Error("IDEMPOTENCY_MISMATCH");
        }
        const payment = await this.db.findPaymentById(existingKey.resultId, businessId);
        if (!payment || !payment.providerRef) throw new Error("PAYMENT_PROVIDER_INVALID_RESPONSE");
        const snapshot = await this.paymongo.retrieveCheckout(payment.providerRef);
        if (snapshot.paid) throw new Error("PAYMENT_ALREADY_SUCCEEDED");
        if (!snapshot.checkoutUrl) throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
        return {
          sale: await this.ops.embedSale(sale),
          payment,
          checkoutUrl: snapshot.checkoutUrl,
          checkoutSessionId: payment.providerRef,
          replayed: true,
        };
      }

      const priorPayments = await this.db.listPaymentsBySale(sale.id, businessId);
      if (priorPayments.some(
        (payment) => payment.status === "SUCCEEDED" && isPayMongoMethod(payment.method) && payment.providerRef?.startsWith("cs_"),
      )) {
        throw new Error("PAYMENT_ALREADY_SUCCEEDED");
      }
      const pending = priorPayments.find(
        (payment) => payment.status === "PENDING" && isPayMongoMethod(payment.method) && payment.providerRef?.startsWith("cs_"),
      );
      if (pending?.providerRef) {
        if (pending.method !== method) throw new Error("PAYMENT_PROVIDER_MISMATCH");
        const snapshot = await this.paymongo.retrieveCheckout(pending.providerRef);
        if (snapshot.paid) throw new Error("PAYMENT_ALREADY_SUCCEEDED");
        if (snapshot.status === "active" && snapshot.checkoutUrl) {
          return {
            sale: await this.ops.embedSale(sale),
            payment: pending,
            checkoutUrl: snapshot.checkoutUrl,
            checkoutSessionId: pending.providerRef,
            replayed: true,
          };
        }
        if (snapshot.status === "expired") {
          await this.db.updatePayment(pending.id, businessId, { status: "FAILED" });
          recordPaymentHandoff("failed");
          if (sale.status === "PENDING_PAYMENT") {
            sale = (await this.db.updateSale(sale.id, businessId, {
              status: transitionSale(sale.status, "PAYMENT_FAILED"),
            })) ?? sale;
          }
        } else {
          // A pending provider attempt with an unknown/non-resumable state is
          // financially uncertain. Do not create a second checkout until the
          // existing attempt is definitively active, expired, or paid.
          throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
        }
      }

      const base = webUrl.replace(/\/$/, "");
      const safePath = (value: string): string => {
        if (!value.startsWith("/") || value.startsWith("//")) throw new Error("VALIDATION");
        return value;
      };
      const successPath = returnPaths
        ? safePath(returnPaths.successPath)
        : `/sales/${encodeURIComponent(sale.id)}?paymongo=success`;
      const cancelPath = returnPaths
        ? safePath(returnPaths.cancelPath)
        : `/sales/${encodeURIComponent(sale.id)}?paymongo=cancelled`;
      const remote = await this.paymongo.createCheckout({
        saleId: sale.id,
        receiptNo: sale.receiptNo,
        businessId,
        method,
        idempotencyKey: key,
        successUrl: `${base}${successPath}`,
        cancelUrl: `${base}${cancelPath}`,
        lineItems: [{ name: `NexPOS sale ${sale.receiptNo}`, amount: sale.totalMinor, quantity: 1 }],
      });

      const payment = await this.db.createPayment({
        businessId,
        saleId: sale.id,
        method,
        amountMinor: sale.totalMinor,
        status: "PENDING",
        providerRef: remote.sessionId,
        idempotencyKey: `${key}:paymongo`,
      });
      let nextStatus = sale.status;
      if (nextStatus === "DRAFT" || nextStatus === "PAYMENT_FAILED") {
        nextStatus = transitionSale(nextStatus, "PENDING_PAYMENT");
      }
      sale = (await this.db.updateSale(sale.id, businessId, { status: nextStatus })) ?? sale;
      await this.db.claimIdempotency({
        businessId,
        key,
        commandType: "paymongo.checkout",
        fingerprint,
        resultId: payment.id,
      });
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "payment.paymongo.checkout",
        entityType: "Payment",
        entityId: payment.id,
        requestId,
      });
      recordPaymentHandoff("started");
      return {
        sale: await this.ops.embedSale(sale),
        payment,
        checkoutUrl: remote.checkoutUrl,
        checkoutSessionId: remote.sessionId,
        replayed: false,
      };
    });
  }

  async queryProvider(
    businessId: string,
    paymentId: string,
    provider = "manual",
  ): Promise<{ status: ProviderVerdict }> {
    const payment = await this.db.findPaymentById(paymentId, businessId);
    if (!payment) throw new Error("NOT_FOUND");
    if (provider === "paymongo" || payment.providerRef?.startsWith("cs_")) {
      if (!payment.providerRef || !this.paymongo.configured()) return { status: "UNKNOWN" };
      const snapshot = await this.paymongo.retrieveCheckout(payment.providerRef);
      if (snapshot.paid) return { status: "SUCCEEDED" };
      if (snapshot.status === "expired") return { status: "FAILED" };
      return { status: "UNKNOWN" };
    }
    return {
      status: await queryProviderStatus(payment.method, payment.providerRef, provider, businessId),
    };
  }
}

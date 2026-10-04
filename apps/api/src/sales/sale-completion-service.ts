import type { DbPort, DbSale } from "../common/db.port";
import { incrementMetric } from "../common/metrics";
import { BillingService } from "../billing/nest/billing.service";
import { ShiftService } from "../shifts/nest/shift.service";
import { computeSaleTotals } from "./totals";
import { fingerprintPayload } from "./idempotency";
import { resolvePaymentMethods } from "./payment-methods";
import { transitionSale } from "./state-machine";
import type { PaymentInput, SaleWithLines } from "./sales-types";
import { SalesStockService } from "./sale-stock-service";
import { StoredValueService } from "../value/stored-value.service";

const CASH_METHODS = new Set(["cash"]);

export class SalesCompletionService {
  constructor(
    private readonly db: DbPort,
    private readonly stock: SalesStockService,
    private readonly shifts: ShiftService,
    private readonly storedValue = new StoredValueService(db),
  ) {}

  private async requireSale(businessId: string, saleId: string): Promise<DbSale> {
    const sale = await this.db.findSaleById(saleId, businessId);
    if (!sale) throw new Error("NOT_FOUND");
    return sale;
  }

  private async embed(sale: DbSale): Promise<SaleWithLines> {
    const items = await this.db.listSaleItems(sale.id, sale.businessId);
    const payments = await this.db.listPaymentsBySale(sale.id, sale.businessId);
    return { ...sale, items, payments };
  }

  private async businessTaxRateBps(businessId: string): Promise<number | null> {
    const settings = await this.db.getSettings(businessId);
    const rate = settings["taxRateBps"];
    return typeof rate === "number" ? rate : null;
  }

  async completeSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    input: {
      payments: PaymentInput[];
      key: string;
      granted: string[];
      registerId?: string;
      branchId?: string | null;
    },
  ): Promise<{ sale: SaleWithLines; replayed: boolean; giftCardCodes?: string[] }> {
    return this.db.withLock(`sales:${businessId}`, async () => this.db.withTransaction(async () => {
      const sale = await this.requireSale(businessId, saleId);
      const registerId = input.registerId ?? sale.registerId ?? null;
      let registerBranchId: string | null = null;
      if (input.registerId !== undefined && input.registerId !== null) {
        const register = await this.db.findRegisterById(input.registerId, businessId);
        if (!register) throw new Error("VALIDATION");
        registerBranchId = register.branchId ?? null;
      } else if (registerId) {
        const register = await this.db.findRegisterById(registerId, businessId);
        registerBranchId = register?.branchId ?? null;
      }
      if (sale.branchId != null && registerBranchId !== null && sale.branchId !== registerBranchId) {
        throw new Error("VALIDATION");
      }
      let branchId: string | null = sale.branchId ?? registerBranchId;
      if (input.branchId !== undefined && input.branchId !== null) {
        const branch = await this.db.findBranchById(input.branchId, businessId);
        if (!branch) throw new Error("VALIDATION");
        if (
          (registerBranchId !== null && branch.id !== registerBranchId) ||
          (sale.branchId != null && branch.id !== sale.branchId)
        ) {
          throw new Error("VALIDATION");
        }
        branchId = branch.id;
      }

      const fingerprint = fingerprintPayload({ saleId, payments: input.payments, registerId });
      const existing = await this.db.findIdempotency(businessId, input.key, "sale.complete");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const original = await this.requireSale(businessId, existing.resultId);
        return { sale: await this.embed(original), replayed: true };
      }
      if (sale.status !== "DRAFT" && sale.status !== "PENDING_PAYMENT") {
        throw new Error("SALE_INVALID_TRANSITION");
      }

      const items = await this.db.listSaleItems(sale.id, businessId);
      if (items.length === 0) throw new Error("VALIDATION");
      const configured = new Set((await resolvePaymentMethods(this.db, businessId)).map((method) => method.key));
      for (const payment of input.payments) {
        if (!configured.has(payment.method)) throw new Error("VALIDATION");
      }

      const totals = computeSaleTotals({
        lines: items.map((item) => ({
          qty: item.qty,
          priceMinor: item.priceMinor,
          costMinor: item.costMinor,
          taxRateBps: item.taxRateBps,
          lineDiscountMinor: item.lineDiscountMinor,
        })),
        orderDiscountMinor: sale.discountMinor,
        businessTaxRateBps: await this.businessTaxRateBps(businessId),
      });
      const giftLoads = await this.db.listSaleGiftCardLoads(sale.id, businessId);
      const giftLoadMinor = giftLoads.reduce((sum, load) => sum + load.amountMinor, 0);
      const saleTotalMinor = totals.totalMinor + giftLoadMinor;
      const paid = input.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (paid < saleTotalMinor) throw new Error("PAYMENT_TOTAL_MISMATCH");
      if (paid > saleTotalMinor && input.payments.some((payment) => !CASH_METHODS.has(payment.method))) {
        throw new Error("PAYMENT_TOTAL_MISMATCH");
      }
      const change = paid - saleTotalMinor;
      const cashMinor = input.payments
        .filter((payment) => CASH_METHODS.has(payment.method))
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (registerId && cashMinor > 0) {
        const open = await this.db.findOpenShiftByRegister(businessId, registerId);
        if (!open) throw new Error("SHIFT_NO_OPEN_SHIFT");
      }

      const unknown = input.payments.some((payment) => (payment.providerRef ?? "").startsWith("unknown-"));
      if (unknown) {
        for (const [legIndex, payment] of input.payments.entries()) {
          await this.db.createPayment({
            businessId,
            saleId: sale.id,
            method: payment.method,
            amountMinor: payment.amountMinor,
            status: "UNKNOWN",
            providerRef: payment.providerRef ?? null,
            internalInstrumentType: ["gift_card", "store_credit", "loyalty"].includes(payment.method) ? payment.method as "gift_card" | "store_credit" | "loyalty" : null,
            internalInstrumentId: payment.internalInstrumentId ?? null,
            idempotencyKey: `${input.key}:${payment.method}:${legIndex}`,
          });
        }
        const fromStatus = sale.status === "DRAFT" ? "PENDING_PAYMENT" : sale.status;
        if (sale.status === "DRAFT") transitionSale("DRAFT", "PENDING_PAYMENT");
        const nextStatus = transitionSale(fromStatus, "PAYMENT_UNKNOWN");
        const updated =
          (await this.db.updateSale(sale.id, businessId, {
            status: nextStatus,
            paidMinor: paid,
            changeMinor: change,
            idempotencyKey: input.key,
            branchId,
            ...(input.registerId !== undefined ? { registerId: input.registerId } : {}),
          })) ?? sale;
        await this.db.claimIdempotency({
          businessId,
          key: input.key,
          commandType: "sale.complete",
          fingerprint,
          resultId: sale.id,
        });
        await this.db.appendAudit({
          businessId,
          actorId,
          action: "sale.complete",
          entityType: "Sale",
          entityId: sale.id,
          requestId,
        });
        incrementMetric("pos_payment_unknown_total");
        return { sale: await this.embed(updated), replayed: false };
      }

      await this.stock.applySale(businessId, actorId, requestId, sale.id, items, branchId);
      let redeemedPointsTotal = 0;
      let redeemedValueTotal = 0;
      for (const [legIndex, payment] of input.payments.entries()) {
        let internalInstrumentId = payment.internalInstrumentId ?? null;
        if (payment.method === "store_credit") {
          if (!sale.customerId) throw new Error("CUSTOMER_REQUIRED");
          internalInstrumentId = (await this.storedValue.ensureStoreCreditAccount(businessId, sale.customerId)).id;
        } else if (payment.method === "loyalty") {
          if (!sale.customerId) throw new Error("CUSTOMER_REQUIRED");
          internalInstrumentId = (await this.storedValue.ensureLoyaltyAccount(businessId, sale.customerId)).id;
        }
        await this.db.createPayment({
          businessId,
          saleId: sale.id,
          method: payment.method,
          amountMinor: payment.amountMinor,
          status: "SUCCEEDED",
          providerRef: payment.providerRef ?? null,
          internalInstrumentType: ["gift_card", "store_credit", "loyalty"].includes(payment.method) ? payment.method as "gift_card" | "store_credit" | "loyalty" : null,
          internalInstrumentId,
          idempotencyKey: `${input.key}:${payment.method}:${legIndex}`,
        });
      }
      for (const [legIndex, payment] of input.payments.entries()) {
        const ledgerKey = `${input.key}:internal:${payment.method}:${legIndex}`;
        if (payment.method === "gift_card") {
          if (!payment.internalInstrumentId) throw new Error("GIFT_CARD_REQUIRED");
          const card = await this.db.findGiftCardById(payment.internalInstrumentId, businessId);
          if (!card || (card.status !== "ACTIVE" && card.status !== "EXHAUSTED")) throw new Error("GIFT_CARD_INVALID_STATUS");
          await this.db.createGiftCardTransaction({ businessId, giftCardId: card.id, type: "REDEEM", amountDeltaMinor: -payment.amountMinor, saleId: sale.id, refundId: null, actorId, requestId, idempotencyKey: ledgerKey, reason: null, branchId });
        } else if (payment.method === "store_credit") {
          if (!sale.customerId) throw new Error("CUSTOMER_REQUIRED");
          const account = await this.storedValue.ensureStoreCreditAccount(businessId, sale.customerId);
          await this.db.createStoreCreditTransaction({ businessId, accountId: account.id, customerId: sale.customerId, type: "REDEEM", amountDeltaMinor: -payment.amountMinor, saleId: sale.id, refundId: null, actorId, requestId, idempotencyKey: ledgerKey, reason: null, branchId });
        } else if (payment.method === "loyalty") {
          if (!sale.customerId) throw new Error("CUSTOMER_REQUIRED");
          const program = await this.db.getLoyaltyProgram(businessId);
          if (!program || !program.enabled) throw new Error("LOYALTY_DISABLED");
          const points = payment.amountMinor * program.redeemPoints / program.redeemValueMinor;
          if (!Number.isInteger(points)) throw new Error("LOYALTY_VALUE_INVALID");
          redeemedPointsTotal += points;
          redeemedValueTotal += payment.amountMinor;
          const account = await this.storedValue.ensureLoyaltyAccount(businessId, sale.customerId);
          await this.db.createLoyaltyTransaction({ businessId, accountId: account.id, customerId: sale.customerId, type: "REDEEM", pointsDelta: -points, valueMinorSnapshot: payment.amountMinor, saleId: sale.id, refundId: null, actorId, requestId, idempotencyKey: ledgerKey, reason: null });
        }
      }
      const giftCardCodes: string[] = [];
      for (const load of giftLoads) {
        let cardId = load.giftCardId;
        if (load.kind === "NEW") {
          const issued = await this.storedValue.issueGiftCard(businessId, actorId, requestId, `${input.key}:gift-card:${load.id}`);
          cardId = issued.card.id;
          giftCardCodes.push(issued.code);
          await this.db.updateSaleGiftCardLoad(load.id, businessId, { giftCardId: cardId });
        }
        if (!cardId) throw new Error("GIFT_CARD_REQUIRED");
        await this.db.createGiftCardTransaction({ businessId, giftCardId: cardId, type: "LOAD", amountDeltaMinor: load.amountMinor, saleId: sale.id, refundId: null, actorId, requestId, idempotencyKey: `${input.key}:gift-load:${load.id}`, reason: null, branchId });
      }
      if (sale.customerId) {
        const eligibleSpendMinor = Math.max(0, totals.subtotalMinor - totals.discountMinor);
        const loyalty = await this.db.getLoyaltyProgram(businessId);
        if (loyalty?.enabled && eligibleSpendMinor > 0) {
          const earned = await this.storedValue.earnLoyalty(businessId, actorId, requestId, sale.customerId, eligibleSpendMinor, sale.id, `${input.key}:loyalty:earn`);
          if (redeemedPointsTotal > 0 || redeemedValueTotal > 0) await this.db.updateSaleLoyalty(earned.snapshot.id, businessId, { redeemedPoints: redeemedPointsTotal, redeemedValueMinor: redeemedValueTotal });
        }
      }
      if (registerId && cashMinor > 0) {
        await this.shifts.postCashSale(
          businessId,
          actorId,
          requestId,
          registerId,
          sale.id,
          Math.max(0, cashMinor - change),
        );
      }
      let status = sale.status;
      if (status === "DRAFT") status = transitionSale(status, "PENDING_PAYMENT");
      status = transitionSale(status, "PAID");
      status = transitionSale(status, "COMPLETED");
      const completedAt = new Date();
      const updated =
        (await this.db.updateSale(sale.id, businessId, {
          status,
          subtotalMinor: totals.subtotalMinor,
          taxMinor: totals.taxMinor,
          totalMinor: saleTotalMinor,
          paidMinor: paid,
          changeMinor: change,
          idempotencyKey: input.key,
          branchId,
          completedAt,
          ...(input.registerId !== undefined ? { registerId: input.registerId } : {}),
        })) ?? sale;
      await this.db.claimIdempotency({
        businessId,
        key: input.key,
        commandType: "sale.complete",
        fingerprint,
        resultId: sale.id,
      });
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "sale.complete",
        entityType: "Sale",
        entityId: sale.id,
        requestId,
      });
      await new BillingService(this.db).recordSale(businessId);
      incrementMetric("pos_sales_completed_total");
      return { sale: await this.embed(updated), replayed: false, ...(giftCardCodes.length ? { giftCardCodes } : {}) };
    }));
  }
}

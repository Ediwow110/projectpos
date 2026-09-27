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

const CASH_METHODS = new Set(["cash"]);

export class SalesCompletionService {
  constructor(
    private readonly db: DbPort,
    private readonly stock: SalesStockService,
    private readonly shifts: ShiftService,
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
  ): Promise<{ sale: SaleWithLines; replayed: boolean }> {
    return this.db.withLock(`sales:${businessId}`, async () => {
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
      const paid = input.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (paid < totals.totalMinor) throw new Error("PAYMENT_TOTAL_MISMATCH");
      if (paid > totals.totalMinor && input.payments.some((payment) => !CASH_METHODS.has(payment.method))) {
        throw new Error("PAYMENT_TOTAL_MISMATCH");
      }
      const change = paid - totals.totalMinor;
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
      for (const [legIndex, payment] of input.payments.entries()) {
        await this.db.createPayment({
          businessId,
          saleId: sale.id,
          method: payment.method,
          amountMinor: payment.amountMinor,
          status: "SUCCEEDED",
          providerRef: payment.providerRef ?? null,
          idempotencyKey: `${input.key}:${payment.method}:${legIndex}`,
        });
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
          totalMinor: totals.totalMinor,
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
      return { sale: await this.embed(updated), replayed: false };
    });
  }
}

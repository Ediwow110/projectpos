import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { withScope } from "@pos/database";
import type {
  DbCustomer,
  DbPayment,
  DbPort,
  DbProduct,
  DbRefund,
  DbRefundItem,
  DbSale,
  DbSaleItem,
} from "../../common/db.port";
import { computeSaleTotals, requiresDiscountOverride } from "../totals";
import { transitionSale } from "../state-machine";
import { BillingService } from "../../billing/nest/billing.service";
import { fingerprintPayload } from "../idempotency";
import { queryProviderStatus, type ProviderVerdict } from "../../payments/provider";
import { resolvePaymentMethods } from "../payment-methods";
import { renderReceiptText } from "../receipt-text";
import { incrementMetric } from "../../common/metrics";
import { ShiftService } from "../../shifts/nest/shift.service";

export interface DraftLineInput {
  productId: string;
  qty: number;
  lineDiscountMinor: number;
}

export interface DraftInput {
  lines: DraftLineInput[];
  orderDiscountMinor: number;
  customerId?: string;
  customerName?: string;
  notes?: string;
  registerId?: string;
  // Phase 9a: explicit branch scope; defaults to the register's branch, else null.
  branchId?: string | null;
}

export interface PaymentInput {
  method: string;
  amountMinor: number;
  providerRef?: string;
}

export type SaleWithLines = DbSale & {
  items: DbSaleItem[];
  payments: DbPayment[];
};

export type SaleDetail = SaleWithLines & {
  refunds: Array<DbRefund & { items: DbRefundItem[] }>;
  customer: DbCustomer | null;
};

const CASH_METHODS = new Set(["cash"]);

@Injectable()
export class SalesService {
  private readonly shifts: ShiftService;

  constructor(@Inject("DbPort") private readonly db: DbPort) {
    // Same-DbPort instance (not Nest DI) to avoid a Sales<->Shift DI cycle.
    this.shifts = new ShiftService(db);
  }

  private readonly locks = new Map<string, Promise<void>>();

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }

  private async requireProduct(businessId: string, productId: string): Promise<DbProduct> {
    const product = await this.db.findProductById(productId, businessId);
    if (!product || !product.isActive) throw new Error("NOT_FOUND");
    return product;
  }

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

  async createDraft(
    businessId: string,
    actorId: string,
    requestId: string,
    input: DraftInput,
    granted: string[],
  ): Promise<DbSale> {
    withScope(businessId, {});
    const businessTax = await this.businessTaxRateBps(businessId);
    const lines: Array<{
      product: DbProduct;
      qty: number;
      lineDiscountMinor: number;
    }> = [];
    for (const line of input.lines) {
      const product = await this.requireProduct(businessId, line.productId);
      lines.push({ product, qty: line.qty, lineDiscountMinor: line.lineDiscountMinor ?? 0 });
    }
    const subtotalGuess = lines.reduce(
      (sum, l) => sum + Math.max(0, l.qty * l.product.priceMinor - l.lineDiscountMinor),
      0,
    );
    if (
      requiresDiscountOverride({
        orderDiscountMinor: input.orderDiscountMinor ?? 0,
        subtotalMinor: subtotalGuess,
        lines: lines.map((l) => ({
          lineDiscountMinor: l.lineDiscountMinor,
          qty: l.qty,
          priceMinor: l.product.priceMinor,
        })),
      }) &&
      !granted.includes("discount.override")
    ) {
      throw new Error("FORBIDDEN");
    }
    const totals = computeSaleTotals({
      lines: lines.map((l) => ({
        qty: l.qty,
        priceMinor: l.product.priceMinor,
        costMinor: l.product.costMinor,
        taxRateBps: l.product.taxRateBps,
        lineDiscountMinor: l.lineDiscountMinor,
      })),
      orderDiscountMinor: input.orderDiscountMinor ?? 0,
      businessTaxRateBps: businessTax,
    });
    const receiptNo = await this.db.nextReceiptNo(businessId);
    let registerId: string | null = null;
    let registerBranchId: string | null = null;
    if (input.registerId !== undefined) {
      const reg = await this.db.findRegisterById(input.registerId, businessId);
      if (!reg) throw new Error("VALIDATION");
      registerId = reg.id;
      registerBranchId = reg.branchId ?? null;
    }
    let branchId: string | null = registerBranchId;
    if (input.branchId !== undefined && input.branchId !== null) {
      const branch = await this.db.findBranchById(input.branchId, businessId);
      if (!branch) throw new Error("VALIDATION");
      branchId = branch.id;
    }
    let customerId: string | null = null;
    let customerName: string | null = input.customerName?.trim() ? input.customerName.trim() : null;
    if (input.customerId !== undefined && input.customerId !== null) {
      // Customer profiles are a paid feature: attaching one on a plan without
      // customers would smuggle paid data into the daily loop.
      await new BillingService(this.db).requireFeature(businessId, "customers", actorId, requestId);
      const customer = await this.db.findCustomerById(input.customerId, businessId);
      if (!customer) throw new Error("VALIDATION");
      customerId = customer.id;
      if (!customerName) customerName = customer.name;
    }
    const sale = await this.db.createSale({
      businessId,
      receiptNo,
      status: "DRAFT",
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      paidMinor: 0,
      changeMinor: 0,
      currency: "PHP",
      customerId,
      customerName,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      actorId,
      requestId,
      idempotencyKey: null,
      registerId,
      branchId,
      createdAt: new Date(),
    });
    for (const l of lines) {
      await this.db.createSaleItem({
        businessId,
        saleId: sale.id,
        productId: l.product.id,
        name: l.product.name,
        unit: l.product.unit,
        qty: l.qty,
        priceMinor: l.product.priceMinor,
        costMinor: l.product.costMinor,
        taxRateBps: l.product.taxRateBps,
        lineDiscountMinor: l.lineDiscountMinor,
        lineTotalMinor: Math.max(0, l.qty * l.product.priceMinor - l.lineDiscountMinor),
      });
    }
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "sale.draft",
      entityType: "Sale",
      entityId: sale.id,
      requestId,
    });
    return { ...sale, ...totals, totalMinor: totals.totalMinor };
  }

  async completeSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    input: { payments: PaymentInput[]; key: string; granted: string[]; registerId?: string; branchId?: string | null },
  ): Promise<{ sale: SaleWithLines; replayed: boolean }> {
    withScope(businessId, {});
    return this.withLock(`sales:${businessId}`, async () => {
      const sale = await this.requireSale(businessId, saleId);
      const registerId = input.registerId ?? sale.registerId ?? null;
      let registerBranchId: string | null = null;
      if (input.registerId !== undefined && input.registerId !== null) {
        const reg = await this.db.findRegisterById(input.registerId, businessId);
        if (!reg) throw new Error("VALIDATION");
        registerBranchId = reg.branchId ?? null;
      } else if (registerId) {
        const reg = await this.db.findRegisterById(registerId, businessId);
        registerBranchId = reg?.branchId ?? null;
      }
      let branchId: string | null = sale.branchId ?? registerBranchId;
      if (input.branchId !== undefined && input.branchId !== null) {
        const branch = await this.db.findBranchById(input.branchId, businessId);
        if (!branch) throw new Error("VALIDATION");
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
      // FR-PAY-01: every tender must be one of the business's configured
      // methods; the static enum in the wire schema only bounds the shape.
      const methods = await resolvePaymentMethods(this.db, businessId);
      const configured = new Set(methods.map((m) => m.key));
      for (const p of input.payments) {
        if (!configured.has(p.method)) throw new Error("VALIDATION");
      }
      const businessTax = await this.businessTaxRateBps(businessId);
      const totals = computeSaleTotals({
        lines: items.map((i) => ({
          qty: i.qty,
          priceMinor: i.priceMinor,
          costMinor: i.costMinor,
          taxRateBps: i.taxRateBps,
          lineDiscountMinor: i.lineDiscountMinor,
        })),
        orderDiscountMinor: sale.discountMinor,
        businessTaxRateBps: businessTax,
      });
      const paid = input.payments.reduce((sum, p) => sum + p.amountMinor, 0);
      if (paid < totals.totalMinor) throw new Error("PAYMENT_TOTAL_MISMATCH");
      if (paid > totals.totalMinor && input.payments.some((p) => !CASH_METHODS.has(p.method))) {
        throw new Error("PAYMENT_TOTAL_MISMATCH");
      }
      const change = paid - totals.totalMinor;
      const cashMinor = input.payments
        .filter((p) => CASH_METHODS.has(p.method))
        .reduce((sum, p) => sum + p.amountMinor, 0);
      if (registerId && cashMinor > 0) {
        const open = await this.db.findOpenShiftByRegister(businessId, registerId);
        if (!open) throw new Error("SHIFT_NO_OPEN_SHIFT");
      }
      const unknown = input.payments.some((p) => (p.providerRef ?? "").startsWith("unknown-"));
      if (unknown) {
        for (const [legIndex, p] of input.payments.entries()) {
          await this.db.createPayment({
            businessId,
            saleId: sale.id,
            method: p.method,
            amountMinor: p.amountMinor,
            status: "UNKNOWN",
            providerRef: p.providerRef ?? null,
            idempotencyKey: `${input.key}:${p.method}:${legIndex}`,
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
        await this.applyStockEffect(businessId, actorId, requestId, sale.id, items, sale.branchId ?? null);
      // A split may repeat a method (two cash legs), so the idempotency key
      // carries the leg index, not just the method.
      for (const [legIndex, p] of input.payments.entries()) {
        await this.db.createPayment({
          businessId,
          saleId: sale.id,
          method: p.method,
          amountMinor: p.amountMinor,
          status: "SUCCEEDED",
          providerRef: p.providerRef ?? null,
          idempotencyKey: `${input.key}:${p.method}:${legIndex}`,
        });
      }
      if (registerId && cashMinor > 0) {
        // Cash in the drawer is what the customer handed over minus the change
        // returned: posting the gross would overstate expected cash at close.
        await this.shifts.postCashSale(businessId, actorId, requestId, registerId, sale.id, Math.max(0, cashMinor - change));
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
      // Phase 10 metering: the auditable monthly sales counter moves with the
      // completed sale (same critical section as the write above, so replays
      // never double-count and failures never leave a phantom sale counted).
      await new BillingService(this.db).recordSale(businessId);
      incrementMetric("pos_sales_completed_total");
      return { sale: await this.embed(updated), replayed: false };
    });
  }

  private async applyStockEffect(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    items: DbSaleItem[],
    branchId: string | null = null,
  ): Promise<void> {
    for (const item of items) {
      const product = await this.requireProduct(businessId, item.productId);
      if (!product.trackInventory) continue;
      const current = await this.db.findBalance(item.productId, businessId, branchId);
      const onHand = current?.qtyOnHand ?? 0;
      if (onHand - item.qty < 0) {
        incrementMetric("pos_inventory_failures_total");
        throw new Error("INSUFFICIENT_STOCK");
      }
    }
    for (const item of items) {
      const product = await this.requireProduct(businessId, item.productId);
      if (!product.trackInventory) continue;
      const current = await this.db.findBalance(item.productId, businessId, branchId);
      const onHand = current?.qtyOnHand ?? 0;
      await this.db.createMovement({
        businessId,
        productId: item.productId,
        type: "sale",
        qtyDelta: -item.qty,
        reason: null,
        referenceType: "Sale",
        referenceId: saleId,
        actorId,
        requestId,
        branchId,
      });
      await this.db.upsertBalance({
        businessId,
        branchId,
        productId: item.productId,
        qtyOnHand: onHand - item.qty,
      });
    }
  }

  async queryProvider(
    businessId: string,
    paymentId: string,
    provider = "manual",
  ): Promise<{ status: ProviderVerdict }> {
    withScope(businessId, {});
    const payment = await this.db.findPaymentById(paymentId, businessId);
    if (!payment) throw new Error("NOT_FOUND");
    return {
      status: await queryProviderStatus(payment.method, payment.providerRef, provider, businessId),
    };
  }

  async reconcilePayment(
    businessId: string,
    actorId: string,
    requestId: string,
    paymentId: string,
    outcome: "SUCCEEDED" | "FAILED",
    key: string,
  ): Promise<{ sale: SaleWithLines; payment: DbPayment }> {
    withScope(businessId, {});
    return this.withLock(`sales:${businessId}`, async () => {
      const fingerprint = fingerprintPayload({ paymentId, outcome });
      const existing = await this.db.findIdempotency(businessId, key, "payment.reconcile");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const payment = await this.db.findPaymentById(paymentId, businessId);
        if (!payment) throw new Error("NOT_FOUND");
        const sale = await this.requireSale(businessId, payment.saleId);
        return { sale: await this.embed(sale), payment };
      }
      const payment = await this.db.findPaymentById(paymentId, businessId);
      if (!payment) throw new Error("NOT_FOUND");
      if (payment.status !== "UNKNOWN") throw new Error("SALE_INVALID_TRANSITION");
      const sale = await this.requireSale(businessId, payment.saleId);
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

      // A split sale is only settled when every leg is: one settled leg must not
      // complete the sale (or apply stock) while another payment is unresolved.
      const legs = await this.db.listPaymentsBySale(sale.id, businessId);
      const unresolved = legs.some((p) => p.status === "UNKNOWN");
      if (unresolved) {
        return { sale: await this.embed(sale), payment: updatedPayment };
      }
      const succeeded = legs
        .filter((p) => p.status === "SUCCEEDED")
        .reduce((sum, p) => sum + p.amountMinor, 0);
      const anyFailed = legs.some((p) => p.status === "FAILED");

      if (anyFailed || succeeded < sale.totalMinor) {
        // Follow the established chain: a resolved payment reconciles the sale,
        // then the shortfall moves it to PAYMENT_FAILED.
        const failed = transitionSale(transitionSale(sale.status, "RECONCILED"), "PENDING_PAYMENT");
        const failedSale =
          (await this.db.updateSale(sale.id, businessId, {
            status: transitionSale(failed, "PAYMENT_FAILED"),
          })) ?? sale;
        return { sale: await this.embed(failedSale), payment: updatedPayment };
      }

      const items = await this.db.listSaleItems(sale.id, businessId);
      await this.applyStockEffect(businessId, actorId, requestId, sale.id, items, sale.branchId ?? null);
      const cashMinor = legs
        .filter((p) => p.status === "SUCCEEDED" && CASH_METHODS.has(p.method))
        .reduce((sum, p) => sum + p.amountMinor, 0);
      if (sale.registerId && cashMinor > 0) {
        const open = await this.db.findOpenShiftByRegister(businessId, sale.registerId);
        if (!open) throw new Error("SHIFT_NO_OPEN_SHIFT");
        await this.shifts.postCashSale(
          businessId, actorId, requestId, sale.registerId, sale.id, Math.max(0, cashMinor - sale.changeMinor),
        );
      }
      let status = transitionSale(sale.status, "RECONCILED");
      status = transitionSale(status, "PENDING_PAYMENT");
      status = transitionSale(status, "PAID");
      status = transitionSale(status, "COMPLETED");
      const completedAt = new Date();
      const updated =
        (await this.db.updateSale(sale.id, businessId, { status, completedAt })) ?? sale;
      // The sale reaches COMPLETED here, so this is where its monthly usage
      // is metered (a sale completed directly never reaches this path).
      await new BillingService(this.db).recordSale(businessId, completedAt);
      return { sale: await this.embed(updated), payment: updatedPayment };
    });
  }

  async holdSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
  ): Promise<{ id: string }> {
    withScope(businessId, {});
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
    withScope(businessId, {});
    const sale = await this.requireSale(businessId, saleId);
    if (sale.status !== "DRAFT") throw new Error("SALE_INVALID_TRANSITION");
    if (sale.actorId !== actorId) throw new Error("FORBIDDEN");
    const heldList = await this.db.listHeldSales(businessId, actorId);
    const held = heldList.find(
      (h) => (h.payload as { saleId?: string } | null)?.saleId === saleId && h.resumedAt === null,
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
  ): Promise<DbSale> {
    withScope(businessId, {});
    if (!granted.includes("sale.void")) throw new Error("FORBIDDEN");
    if (!reason || reason.trim().length < 3) throw new Error("VALIDATION");
    const sale = await this.requireSale(businessId, saleId);
    if (sale.status === "COMPLETED") throw new Error("SALE_INVALID_TRANSITION");
    const status = transitionSale(sale.status, "VOIDED");
    const updated = (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "sale.void",
      entityType: "Sale",
      entityId: sale.id,
      requestId,
    });
    return updated;
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
    withScope(businessId, {});
    if (!granted.includes("sale.refund")) throw new Error("FORBIDDEN");
    if (!reason || reason.trim().length < 3) throw new Error("VALIDATION");
    const fingerprint = fingerprintPayload({ saleId, reason });
    const existing = await this.db.findIdempotency(businessId, key, "refund.request");
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
      return this.requireSale(businessId, existing.resultId);
    }
    const sale = await this.requireSale(businessId, saleId);
    if (sale.status !== "COMPLETED") throw new Error("SALE_INVALID_TRANSITION");
    const status = transitionSale(sale.status, "REFUND_REQUESTED");
    const updated = (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
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
  }

  async getSale(
    businessId: string,
    saleId: string,
    granted: string[],
    role: string = "owner",
  ): Promise<SaleDetail> {
    withScope(businessId, {});
    const sale = await this.requireSale(businessId, saleId);
    const full = await this.embed(sale);
    const items = granted.includes("cost.view")
      ? full.items
      : full.items.map((i) => {
          const { costMinor: _omitted, ...rest } = i;
          void _omitted;
          return { ...rest, costMinor: 0 } as DbSaleItem;
        });
    const refundRows = await this.db.listRefundsBySale(sale.id, businessId);
    const refunds: Array<DbRefund & { items: DbRefundItem[] }> = [];
    for (const r of refundRows) {
      refunds.push({ ...r, items: await this.db.listRefundItems(r.id, businessId) });
    }
    let customer: DbCustomer | null = null;
    if (sale.customerId) {
      const row = await this.db.findCustomerById(sale.customerId, businessId);
      if (row) {
        customer = role === "cashier" ? { ...row, phone: null, email: null, address: null } : row;
      }
    }
    return { ...full, items, refunds, customer };
  }

  async listSales(
    businessId: string,
    opts: { cursor?: string; limit: number; status?: string; customerId?: string; dateFrom?: string; dateTo?: string },
  ): Promise<{ items: DbSale[]; nextCursor: string | null }> {
    withScope(businessId, {});
    let rows = await this.db.listSalesByBusiness(businessId);
    if (opts.status) rows = rows.filter((s) => s.status === opts.status);
    if (opts.customerId) rows = rows.filter((s) => s.customerId === opts.customerId);
    let from: number | null = null;
    let to: number | null = null;
    if (opts.dateFrom !== undefined) {
      from = new Date(opts.dateFrom).getTime();
      if (Number.isNaN(from)) throw new Error("VALIDATION");
    }
    if (opts.dateTo !== undefined) {
      to = new Date(opts.dateTo).getTime();
      if (Number.isNaN(to)) throw new Error("VALIDATION");
    }
    if (from !== null && to !== null && to - from > 366 * 24 * 3600 * 1000) {
      throw new Error("VALIDATION");
    }
    if (from !== null) rows = rows.filter((s) => s.createdAt.getTime() >= (from as number));
    if (to !== null) rows = rows.filter((s) => s.createdAt.getTime() <= (to as number));
    rows = [...rows].sort((a, b) => (a.receiptNo < b.receiptNo ? 1 : -1));
    let start = 0;
    if (opts.cursor) {
      const idx = rows.findIndex((s) => s.id === opts.cursor);
      start = idx === -1 ? 0 : idx + 1;
    }
    const items = rows.slice(start, start + opts.limit);
    const nextCursor =
      start + opts.limit < rows.length ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async buildSalesExport(
    businessId: string,
    opts: { status?: string; customerId?: string; dateFrom?: string; dateTo?: string },
  ): Promise<{ headers: string[]; rows: Array<Array<string | number | null>> }> {
    withScope(businessId, {});
    const { items } = await this.listSales(businessId, { ...opts, limit: 1000 });
    return {
      headers: ["id", "receiptNo", "status", "subtotalMinor", "discountMinor", "taxMinor", "totalMinor", "paidMinor", "changeMinor", "currency", "customerName", "registerId"],
      rows: items.map((s) => [
        s.id, s.receiptNo, s.status, s.subtotalMinor, s.discountMinor, s.taxMinor,
        s.totalMinor, s.paidMinor, s.changeMinor, s.currency, s.customerName, s.registerId,
      ]),
    };
  }

  async receiptData(businessId: string, saleId: string): Promise<{
    receiptNo: string;
    saleId: string;
    businessId: string;
    currency: string;
    status: string;
    customerName: string | null;
    items: DbSaleItem[];
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    paidMinor: number;
    changeMinor: number;
    payments: DbPayment[];
  }> {
    withScope(businessId, {});
    const sale = await this.requireSale(businessId, saleId);
    const full = await this.embed(sale);
    return {
      receiptNo: sale.receiptNo,
      saleId: sale.id,
      businessId: sale.businessId,
      currency: sale.currency,
      status: sale.status,
      customerName: sale.customerName,
      items: full.items,
      subtotalMinor: sale.subtotalMinor,
      discountMinor: sale.discountMinor,
      taxMinor: sale.taxMinor,
      totalMinor: sale.totalMinor,
      paidMinor: sale.paidMinor,
      changeMinor: sale.changeMinor,
      payments: full.payments,
    };
  }

  // FR-RECEIPT-01: the downloadable form of the receipt.
  async downloadReceipt(businessId: string, saleId: string): Promise<{ filename: string; text: string }> {
    const receipt = await this.receiptData(businessId, saleId);
    const text = renderReceiptText({
      receiptNo: receipt.receiptNo,
      status: receipt.status,
      items: receipt.items.map((i) => ({ name: i.name, qty: i.qty, lineTotalMinor: i.lineTotalMinor })),
      subtotalMinor: receipt.subtotalMinor,
      discountMinor: receipt.discountMinor,
      taxMinor: receipt.taxMinor,
      totalMinor: receipt.totalMinor,
      paidMinor: receipt.paidMinor,
      changeMinor: receipt.changeMinor,
      tenders: receipt.payments.map((p) => ({ method: p.method, amountMinor: p.amountMinor })),
    });
    return { filename: `receipt-${receipt.receiptNo}.txt`, text };
  }

  // FR-RECEIPT-01: a share link renders the receipt readable without a
  // session; the token is single-secret, hashed at rest, and short-lived.
  async createShareToken(businessId: string, actorId: string, requestId: string, saleId: string): Promise<{ token: string; expiresAt: Date }> {
    await this.receiptData(businessId, saleId);
    const token = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    await this.db.createReceiptShare({ businessId, saleId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt });
    await this.db.appendAudit({
      businessId, actorId, action: "receipt.shared", entityType: "Sale", entityId: saleId, requestId,
    });
    return { token, expiresAt };
  }

  async sharedReceipt(token: string): Promise<{
    receiptNo: string; status: string;
    items: Array<{ name: string; qty: number; lineTotalMinor: number }>;
    subtotalMinor: number; discountMinor: number; taxMinor: number;
    totalMinor: number; paidMinor: number; changeMinor: number;
    tenders: Array<{ method: string; amountMinor: number }>;
  }> {
    if (typeof token !== "string" || token.length < 16) throw new Error("NOT_FOUND");
    const share = await this.db.findValidReceiptShare(createHash("sha256").update(token).digest("hex"));
    if (!share) throw new Error("NOT_FOUND");
    const receipt = await this.receiptData(share.businessId, share.saleId);
    return {
      receiptNo: receipt.receiptNo,
      status: receipt.status,
      items: receipt.items.map((i) => ({ name: i.name, qty: i.qty, lineTotalMinor: i.lineTotalMinor })),
      subtotalMinor: receipt.subtotalMinor,
      discountMinor: receipt.discountMinor,
      taxMinor: receipt.taxMinor,
      totalMinor: receipt.totalMinor,
      paidMinor: receipt.paidMinor,
      changeMinor: receipt.changeMinor,
      tenders: receipt.payments.map((p) => ({ method: p.method, amountMinor: p.amountMinor })),
    };
  }
}

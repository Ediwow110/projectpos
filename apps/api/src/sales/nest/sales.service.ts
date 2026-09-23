import { Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type {
  DbPayment,
  DbPort,
  DbProduct,
  DbSale,
  DbSaleItem,
} from "../../common/db.port";
import { computeSaleTotals, requiresDiscountOverride } from "../totals";
import { transitionSale } from "../state-machine";
import { fingerprintPayload } from "../idempotency";

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

const CASH_METHODS = new Set(["cash"]);

@Injectable()
export class SalesService {
  constructor(private readonly db: DbPort) {}

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
      customerId: input.customerId ?? null,
      customerName: input.customerName?.trim() ? input.customerName.trim() : null,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      actorId,
      requestId,
      idempotencyKey: null,
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
    input: { payments: PaymentInput[]; key: string; granted: string[] },
  ): Promise<{ sale: SaleWithLines; replayed: boolean }> {
    withScope(businessId, {});
    return this.withLock(`sales:${businessId}`, async () => {
      const fingerprint = fingerprintPayload({ saleId, payments: input.payments });
      const existing = await this.db.findIdempotency(businessId, input.key, "sale.complete");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const original = await this.requireSale(businessId, existing.resultId);
        return { sale: await this.embed(original), replayed: true };
      }
      const sale = await this.requireSale(businessId, saleId);
      if (sale.status !== "DRAFT" && sale.status !== "PENDING_PAYMENT") {
        throw new Error("SALE_INVALID_TRANSITION");
      }
      const items = await this.db.listSaleItems(sale.id, businessId);
      if (items.length === 0) throw new Error("VALIDATION");
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
      const unknown = input.payments.some((p) => (p.providerRef ?? "").startsWith("unknown-"));
      if (unknown) {
        for (const p of input.payments) {
          await this.db.createPayment({
            businessId,
            saleId: sale.id,
            method: p.method,
            amountMinor: p.amountMinor,
            status: "UNKNOWN",
            providerRef: p.providerRef ?? null,
            idempotencyKey: `${input.key}:${p.method}`,
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
        return { sale: await this.embed(updated), replayed: false };
      }
      await this.applyStockEffect(businessId, actorId, requestId, sale.id, items);
      for (const p of input.payments) {
        await this.db.createPayment({
          businessId,
          saleId: sale.id,
          method: p.method,
          amountMinor: p.amountMinor,
          status: "SUCCEEDED",
          providerRef: p.providerRef ?? null,
          idempotencyKey: `${input.key}:${p.method}`,
        });
      }
      let status = sale.status;
      if (status === "DRAFT") status = transitionSale(status, "PENDING_PAYMENT");
      status = transitionSale(status, "PAID");
      status = transitionSale(status, "COMPLETED");
      const updated =
        (await this.db.updateSale(sale.id, businessId, {
          status,
          subtotalMinor: totals.subtotalMinor,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          paidMinor: paid,
          changeMinor: change,
          idempotencyKey: input.key,
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
      return { sale: await this.embed(updated), replayed: false };
    });
  }

  private async applyStockEffect(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    items: DbSaleItem[],
  ): Promise<void> {
    for (const item of items) {
      const product = await this.requireProduct(businessId, item.productId);
      if (!product.trackInventory) continue;
      const current = await this.db.findBalance(item.productId, businessId);
      const onHand = current?.qtyOnHand ?? 0;
      if (onHand - item.qty < 0) throw new Error("INSUFFICIENT_STOCK");
    }
    for (const item of items) {
      const product = await this.requireProduct(businessId, item.productId);
      if (!product.trackInventory) continue;
      const current = await this.db.findBalance(item.productId, businessId);
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
      });
      await this.db.upsertBalance({
        businessId,
        productId: item.productId,
        qtyOnHand: onHand - item.qty,
      });
    }
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
      let status = transitionSale(sale.status, "RECONCILED");
      status = transitionSale(status, "PENDING_PAYMENT");
      if (outcome === "SUCCEEDED") {
        const items = await this.db.listSaleItems(sale.id, businessId);
        await this.applyStockEffect(businessId, actorId, requestId, sale.id, items);
        const updatedPayment =
          (await this.db.updatePayment(payment.id, businessId, { status: "SUCCEEDED" })) ?? payment;
        status = transitionSale(status, "PAID");
        status = transitionSale(status, "COMPLETED");
        const updated =
          (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
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
        return { sale: await this.embed(updated), payment: updatedPayment };
      }
      const failedPayment =
        (await this.db.updatePayment(payment.id, businessId, { status: "FAILED" })) ?? payment;
      status = transitionSale(status, "PAYMENT_FAILED");
      const updated =
        (await this.db.updateSale(sale.id, businessId, { status })) ?? sale;
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
      return { sale: await this.embed(updated), payment: failedPayment };
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
  ): Promise<SaleWithLines> {
    withScope(businessId, {});
    const sale = await this.requireSale(businessId, saleId);
    const full = await this.embed(sale);
    if (granted.includes("cost.view")) return full;
    return {
      ...full,
      items: full.items.map((i) => {
        const { costMinor: _omitted, ...rest } = i;
        void _omitted;
        return { ...rest, costMinor: 0 } as DbSaleItem;
      }),
    };
  }

  async listSales(
    businessId: string,
    opts: { cursor?: string; limit: number; status?: string },
  ): Promise<{ items: DbSale[]; nextCursor: string | null }> {
    withScope(businessId, {});
    let rows = await this.db.listSalesByBusiness(businessId);
    if (opts.status) rows = rows.filter((s) => s.status === opts.status);
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
}

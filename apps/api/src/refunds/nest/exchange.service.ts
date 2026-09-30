import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";

import type { DbExchange, DbPort, DbRefund, DbSale } from "../../common/db.port";
import { resolvePaymentMethods } from "../../sales/payment-methods";
import { SalesService } from "../../sales/nest/sales.service";
import { computeSaleTotals } from "../../sales/totals";
import { fingerprintPayload } from "../../sales/idempotency";
import { lineRefundAmount, refundableQty } from "../refund-math";
import { RefundService } from "./refund.service";

export interface ExchangeInput {
  returns: Array<{ saleItemId: string; qty: number }>;
  replacements: Array<{ productId: string; qty: number }>;
  reason: string;
  key: string;
}

export interface ExchangeResult {
  exchange: DbExchange;
  refund: DbRefund;
  replacementSale: DbSale;
  replayed: boolean;
}

@Injectable()
export class ExchangeService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async completeExchange(
    businessId: string,
    actorId: string,
    requestId: string,
    originalSaleId: string,
    input: ExchangeInput,
    granted: string[],
    role: string,
  ): Promise<ExchangeResult> {
    withScope(businessId, {});
    if ((role !== "owner" && role !== "manager") || !granted.includes("sale.refund")) {
      throw new Error("FORBIDDEN");
    }
    const reason = input.reason.trim();
    if (reason.length < 3 || !input.key.trim()) throw new Error("VALIDATION");
    if (input.returns.length === 0 || input.replacements.length === 0) throw new Error("VALIDATION");

    const fingerprint = fingerprintPayload({
      originalSaleId,
      returns: [...input.returns].sort((a, b) => a.saleItemId.localeCompare(b.saleItemId)),
      replacements: [...input.replacements].sort((a, b) => a.productId.localeCompare(b.productId)),
      reason,
    });

    return this.db.withTransaction(async (tx) => tx.withLock(`exchange:${businessId}:${originalSaleId}`, async () => {
      const existing = await tx.findIdempotency(businessId, input.key, "exchange.complete");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const exchange = await tx.findExchangeById(existing.resultId, businessId);
        if (!exchange) throw new Error("NOT_FOUND");
        const refund = await tx.findRefundById(exchange.refundId, businessId);
        const replacementSale = await tx.findSaleById(exchange.replacementSaleId, businessId);
        if (!refund || !replacementSale) throw new Error("NOT_FOUND");
        return { exchange, refund, replacementSale, replayed: true };
      }

      const originalSale = await tx.findSaleById(originalSaleId, businessId);
      if (!originalSale) throw new Error("NOT_FOUND");
      if (originalSale.status !== "COMPLETED" && originalSale.status !== "PARTIALLY_REFUNDED") {
        throw new Error("SALE_INVALID_TRANSITION");
      }
      if (!originalSale.registerId) throw new Error("VALIDATION");
      if (!(await tx.findOpenShiftByRegister(businessId, originalSale.registerId))) {
        throw new Error("SHIFT_NO_OPEN_SHIFT");
      }

      const succeededPayments = (await tx.listPaymentsBySale(originalSale.id, businessId)).filter((payment) => payment.status === "SUCCEEDED");
      if (succeededPayments.length === 0 || succeededPayments.some((payment) => payment.method !== "cash")) {
        throw new Error("EXCHANGE_CASH_ONLY");
      }
      const configured = new Set((await resolvePaymentMethods(tx, businessId)).map((method) => method.key));
      if (!configured.has("cash")) throw new Error("EXCHANGE_CASH_ONLY");

      const originalLines = await tx.listSaleItems(originalSale.id, businessId);
      const priorRefunds = await tx.listRefundItemsBySale(originalSale.id, businessId);
      const refundedByLine = new Map<string, number>();
      for (const row of priorRefunds) {
        refundedByLine.set(row.saleItemId, (refundedByLine.get(row.saleItemId) ?? 0) + row.qty);
      }
      const seenReturnIds = new Set<string>();
      const resolvedReturns = [] as Array<{ saleItemId: string; productId: string; qty: number; amountMinor: number; tracked: boolean }>;
      for (const requested of input.returns) {
        if (!Number.isInteger(requested.qty) || requested.qty <= 0 || seenReturnIds.has(requested.saleItemId)) throw new Error("VALIDATION");
        seenReturnIds.add(requested.saleItemId);
        const line = originalLines.find((candidate) => candidate.id === requested.saleItemId);
        if (!line) throw new Error("VALIDATION");
        if (requested.qty > refundableQty(line.qty, refundedByLine.get(line.id) ?? 0)) throw new Error("REFUND_EXCEEDS_LIMIT");
        const product = await tx.findProductById(line.productId, businessId);
        resolvedReturns.push({
          saleItemId: line.id,
          productId: line.productId,
          qty: requested.qty,
          amountMinor: lineRefundAmount(line.lineTotalMinor, line.qty, requested.qty),
          tracked: product?.trackInventory === true,
        });
      }
      const returnMinor = resolvedReturns.reduce((sum, row) => sum + row.amountMinor, 0);
      const threshold = (await tx.getSettings(businessId))["refundApprovalThresholdMinor"];
      if (typeof threshold === "number" && returnMinor > threshold && !granted.includes("refund.override")) {
        throw new Error("FORBIDDEN");
      }

      const seenReplacementIds = new Set<string>();
      const replacementRows = [] as Array<{ productId: string; qty: number; priceMinor: number; costMinor: number; taxRateBps: number | null; trackInventory: boolean }>;
      for (const requested of input.replacements) {
        if (!Number.isInteger(requested.qty) || requested.qty <= 0 || seenReplacementIds.has(requested.productId)) throw new Error("VALIDATION");
        seenReplacementIds.add(requested.productId);
        const product = await tx.findProductById(requested.productId, businessId);
        if (!product || !product.isActive) throw new Error("VALIDATION");
        replacementRows.push({
          productId: product.id,
          qty: requested.qty,
          priceMinor: product.priceMinor,
          costMinor: product.costMinor,
          taxRateBps: product.taxRateBps,
          trackInventory: product.trackInventory,
        });
      }

      const returnQtyByProduct = new Map<string, number>();
      for (const row of resolvedReturns) {
        if (!row.tracked) continue;
        returnQtyByProduct.set(row.productId, (returnQtyByProduct.get(row.productId) ?? 0) + row.qty);
      }
      for (const row of replacementRows) {
        if (!row.trackInventory) continue;
        const balance = await tx.findBalance(row.productId, businessId, originalSale.branchId ?? null);
        const availableAfterReturn = (balance?.qtyOnHand ?? 0) + (returnQtyByProduct.get(row.productId) ?? 0);
        if (availableAfterReturn < row.qty) throw new Error("INSUFFICIENT_STOCK");
      }

      const settings = await tx.getSettings(businessId);
      const businessTaxRateBps = typeof settings["taxRateBps"] === "number" ? settings["taxRateBps"] as number : null;
      const previewTotals = computeSaleTotals({
        lines: replacementRows.map((row) => ({
          qty: row.qty,
          priceMinor: row.priceMinor,
          costMinor: row.costMinor,
          taxRateBps: row.taxRateBps,
          lineDiscountMinor: 0,
        })),
        orderDiscountMinor: 0,
        businessTaxRateBps,
      });
      if (previewTotals.totalMinor <= 0) throw new Error("VALIDATION");

      const refunds = new RefundService(tx);
      const refundResult = await refunds.approveRefund(
        businessId,
        actorId,
        requestId,
        originalSale.id,
        {
          items: input.returns,
          reason,
          key: `${input.key}:refund`,
        },
        granted,
        role,
      );

      const sales = new SalesService(tx);
      const replacementDraft = await sales.createDraft(
        businessId,
        actorId,
        requestId,
        {
          lines: replacementRows.map((row) => ({ productId: row.productId, qty: row.qty, lineDiscountMinor: 0 })),
          orderDiscountMinor: 0,
          registerId: originalSale.registerId,
          branchId: originalSale.branchId ?? null,
          ...(originalSale.customerId ? { customerId: originalSale.customerId } : {}),
          ...(!originalSale.customerId && originalSale.customerName ? { customerName: originalSale.customerName } : {}),
          notes: `Exchange for ${originalSale.receiptNo}: ${reason}`,
        },
        granted,
      );
      const completed = await sales.completeSale(
        businessId,
        actorId,
        requestId,
        replacementDraft.id,
        {
          payments: [{ method: "cash", amountMinor: replacementDraft.totalMinor }],
          key: `${input.key}:replacement`,
          granted,
          registerId: originalSale.registerId,
          branchId: originalSale.branchId ?? null,
        },
      );
      const replacementSale = completed.sale;
      const netMinor = replacementSale.totalMinor - refundResult.refund.totalMinor;
      const direction: DbExchange["direction"] = netMinor > 0 ? "COLLECT" : netMinor < 0 ? "REFUND" : "EVEN";
      const exchange = await tx.createExchange({
        businessId,
        originalSaleId: originalSale.id,
        refundId: refundResult.refund.id,
        replacementSaleId: replacementSale.id,
        returnMinor: refundResult.refund.totalMinor,
        replacementMinor: replacementSale.totalMinor,
        netMinor,
        direction,
        reason,
        actorId,
        requestId,
      });
      await tx.claimIdempotency({
        businessId,
        key: input.key,
        commandType: "exchange.complete",
        fingerprint,
        resultId: exchange.id,
      });
      await tx.appendAudit({
        businessId,
        actorId,
        action: "exchange.complete",
        entityType: "Exchange",
        entityId: exchange.id,
        requestId,
        reason,
        after: {
          originalSaleId: originalSale.id,
          refundId: refundResult.refund.id,
          replacementSaleId: replacementSale.id,
          returnMinor: exchange.returnMinor,
          replacementMinor: exchange.replacementMinor,
          netMinor: exchange.netMinor,
          direction: exchange.direction,
        },
      });
      return { exchange, refund: refundResult.refund, replacementSale, replayed: false };
    }));
  }
}

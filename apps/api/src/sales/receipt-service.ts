import { createHash, randomBytes } from "node:crypto";

import type { DbPayment, DbPort, DbReceiptDelivery, DbSaleItem } from "../common/db.port";
import { NOOP_TRANSACTIONAL_EMAIL, type TransactionalEmailPort } from "../email/email.service";
import { renderReceiptText } from "./receipt-text";

export interface ReceiptData {
  receiptNo: string;
  saleId: string;
  businessId: string;
  branchId: string | null;
  currency: string;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  items: DbSaleItem[];
  giftCardLoads: Array<{ amountMinor: number; kind: "NEW" | "RELOAD"; maskedCode: string | null }>;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  payments: DbPayment[];
}

export interface SharedReceipt {
  receiptNo: string;
  status: string;
  items: Array<{ name: string; qty: number; lineTotalMinor: number }>;
  giftCardLoads: Array<{ amountMinor: number; kind: "NEW" | "RELOAD"; maskedCode: string | null }>;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  tenders: Array<{ method: string; amountMinor: number; label?: string }>;
}

export class SalesReceiptService {
  constructor(
    private readonly db: DbPort,
    private readonly email: TransactionalEmailPort = NOOP_TRANSACTIONAL_EMAIL,
  ) {}

  async receiptData(businessId: string, saleId: string): Promise<ReceiptData> {
    const sale = await this.db.findSaleById(saleId, businessId);
    if (!sale) throw new Error("NOT_FOUND");
    const items = await this.db.listSaleItems(sale.id, businessId);
    const loads = await this.db.listSaleGiftCardLoads(sale.id, businessId);
    const giftCardLoads = await Promise.all(loads.map(async (load) => {
      const card = load.giftCardId ? await this.db.findGiftCardById(load.giftCardId, businessId) : null;
      return {
        amountMinor: load.amountMinor,
        kind: load.kind,
        maskedCode: card ? `${card.codePrefix}-••••${card.codeLast4}` : null,
      };
    }));
    const payments = await this.db.listPaymentsBySale(sale.id, businessId);
    const customer = sale.customerId ? await this.db.findCustomerById(sale.customerId, businessId) : null;
    return {
      receiptNo: sale.receiptNo,
      saleId: sale.id,
      businessId: sale.businessId,
      branchId: sale.branchId ?? null,
      currency: sale.currency,
      status: sale.status,
      customerName: sale.customerName,
      customerEmail: customer?.email ?? null,
      items,
      giftCardLoads,
      subtotalMinor: sale.subtotalMinor,
      discountMinor: sale.discountMinor,
      taxMinor: sale.taxMinor,
      totalMinor: sale.totalMinor,
      paidMinor: sale.paidMinor,
      changeMinor: sale.changeMinor,
      payments,
    };
  }

  async downloadReceipt(businessId: string, saleId: string): Promise<{ filename: string; text: string }> {
    const receipt = await this.receiptData(businessId, saleId);
    const text = renderReceiptText({
      receiptNo: receipt.receiptNo,
      status: receipt.status,
      items: receipt.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        lineTotalMinor: item.lineTotalMinor,
      })),
      giftCardLoads: receipt.giftCardLoads,
      subtotalMinor: receipt.subtotalMinor,
      discountMinor: receipt.discountMinor,
      taxMinor: receipt.taxMinor,
      totalMinor: receipt.totalMinor,
      paidMinor: receipt.paidMinor,
      changeMinor: receipt.changeMinor,
      tenders: await Promise.all(receipt.payments.map(async (payment) => ({
        method: payment.method,
        amountMinor: payment.amountMinor,
        ...(payment.internalInstrumentType === "gift_card" && payment.internalInstrumentId
          ? { label: `Gift card ••••${(await this.db.findGiftCardById(payment.internalInstrumentId, businessId))?.codeLast4 ?? ""}` }
          : payment.internalInstrumentType === "store_credit" ? { label: "Store credit" }
          : payment.internalInstrumentType === "loyalty" ? { label: "Loyalty reward" }
          : {}),
      }))),
    });
    return { filename: `receipt-${receipt.receiptNo}.txt`, text };
  }

  async createShareToken(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.receiptData(businessId, saleId);
    const token = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    await this.db.createReceiptShare({
      businessId,
      saleId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "receipt.shared",
      entityType: "Sale",
      entityId: saleId,
      requestId,
    });
    return { token, expiresAt };
  }

  async sharedReceipt(token: string): Promise<SharedReceipt> {
    if (typeof token !== "string" || token.length < 16) throw new Error("NOT_FOUND");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const share = await this.db.findValidReceiptShare(tokenHash);
    if (!share) throw new Error("NOT_FOUND");
    const receipt = await this.receiptData(share.businessId, share.saleId);
    return {
      receiptNo: receipt.receiptNo,
      status: receipt.status,
      items: receipt.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        lineTotalMinor: item.lineTotalMinor,
      })),
      giftCardLoads: receipt.giftCardLoads,
      subtotalMinor: receipt.subtotalMinor,
      discountMinor: receipt.discountMinor,
      taxMinor: receipt.taxMinor,
      totalMinor: receipt.totalMinor,
      paidMinor: receipt.paidMinor,
      changeMinor: receipt.changeMinor,
      tenders: receipt.payments.map((payment) => ({
        method: payment.method,
        amountMinor: payment.amountMinor,
        ...(payment.internalInstrumentType === "store_credit" ? { label: "Store credit" } : payment.internalInstrumentType === "loyalty" ? { label: "Loyalty reward" } : {}),
      })),
    };
  }

  async sendEmailReceipt(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    recipient: string,
    idempotencyKey: string,
  ): Promise<{ delivery: DbReceiptDelivery; replayed: boolean }> {
    const receipt = await this.receiptData(businessId, saleId);
    if (!["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(receipt.status)) {
      throw new Error("VALIDATION");
    }
    const normalizedRecipient = recipient.trim().toLowerCase();
    const claimed = await this.db.claimReceiptDelivery({
      businessId,
      saleId,
      channel: "email",
      recipient: normalizedRecipient,
      status: "PENDING",
      idempotencyKey,
      errorCode: null,
      sentAt: null,
    });
    const existing = claimed.delivery;
    if (!claimed.claimed) {
      if (existing.saleId !== saleId || existing.channel !== "email" || existing.recipient !== normalizedRecipient) {
        throw new Error("IDEMPOTENCY_MISMATCH");
      }
      if (existing.status === "FAILED") throw new Error(existing.errorCode ?? "EMAIL_DELIVERY_FAILED");
      return { delivery: existing, replayed: true };
    }

    try {
      const share = await this.createShareToken(businessId, actorId, requestId, saleId);
      await this.email.sendReceiptShare({
        to: normalizedRecipient,
        customerName: receipt.customerName,
        receiptNo: receipt.receiptNo,
        token: share.token,
      });
      const delivery = await this.db.updateReceiptDelivery(existing.id, businessId, {
        status: "SENT",
        sentAt: new Date(),
        errorCode: null,
      });
      if (!delivery) throw new Error("NOT_FOUND");
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "receipt.email.sent",
        entityType: "ReceiptDelivery",
        entityId: delivery.id,
        requestId,
        after: { saleId, recipient: normalizedRecipient, status: "SENT" },
      });
      return { delivery, replayed: false };
    } catch (error) {
      const code = error instanceof Error && error.message === "NOT_FOUND" ? "NOT_FOUND" : "EMAIL_DELIVERY_FAILED";
      await this.db.updateReceiptDelivery(existing.id, businessId, { status: "FAILED", errorCode: code });
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "receipt.email.failed",
        entityType: "ReceiptDelivery",
        entityId: existing.id,
        requestId,
        after: { saleId, recipient: normalizedRecipient, status: "FAILED", errorCode: code },
      });
      throw new Error(code);
    }
  }

  async listDeliveries(businessId: string, saleId: string): Promise<{ items: DbReceiptDelivery[] }> {
    await this.receiptData(businessId, saleId);
    return { items: await this.db.listReceiptDeliveries(businessId, saleId) };
  }
}

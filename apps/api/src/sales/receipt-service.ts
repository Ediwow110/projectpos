import { createHash, randomBytes } from "node:crypto";

import type { DbPayment, DbPort, DbSaleItem } from "../common/db.port";
import { renderReceiptText } from "./receipt-text";

export interface ReceiptData {
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
}

export interface SharedReceipt {
  receiptNo: string;
  status: string;
  items: Array<{ name: string; qty: number; lineTotalMinor: number }>;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  tenders: Array<{ method: string; amountMinor: number }>;
}

export class SalesReceiptService {
  constructor(private readonly db: DbPort) {}

  async receiptData(businessId: string, saleId: string): Promise<ReceiptData> {
    const sale = await this.db.findSaleById(saleId, businessId);
    if (!sale) throw new Error("NOT_FOUND");
    const items = await this.db.listSaleItems(sale.id, businessId);
    const payments = await this.db.listPaymentsBySale(sale.id, businessId);
    return {
      receiptNo: sale.receiptNo,
      saleId: sale.id,
      businessId: sale.businessId,
      currency: sale.currency,
      status: sale.status,
      customerName: sale.customerName,
      items,
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
      subtotalMinor: receipt.subtotalMinor,
      discountMinor: receipt.discountMinor,
      taxMinor: receipt.taxMinor,
      totalMinor: receipt.totalMinor,
      paidMinor: receipt.paidMinor,
      changeMinor: receipt.changeMinor,
      tenders: receipt.payments.map((payment) => ({
        method: payment.method,
        amountMinor: payment.amountMinor,
      })),
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
      subtotalMinor: receipt.subtotalMinor,
      discountMinor: receipt.discountMinor,
      taxMinor: receipt.taxMinor,
      totalMinor: receipt.totalMinor,
      paidMinor: receipt.paidMinor,
      changeMinor: receipt.changeMinor,
      tenders: receipt.payments.map((payment) => ({
        method: payment.method,
        amountMinor: payment.amountMinor,
      })),
    };
  }
}

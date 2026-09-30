import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type {
  DbCustomer,
  DbPayment,
  DbPort,
  DbRefund,
  DbRefundItem,
  DbSale,
  DbSaleItem,
} from "../../common/db.port";
import { BillingService } from "../../billing/nest/billing.service";
import type { ProviderVerdict } from "../../payments/provider";
import {
  DisabledPayMongo,
  type PayMongoMethod,
  type PayMongoPort,
} from "../../payments/paymongo";
import { SalesLifecycleService } from "../sale-lifecycle-service";
import { SalesPayMongoWebhookService } from "../paymongo-webhook-service";
import { SalesPaymentProviderService } from "../payment-provider-service";
import { SalesPaymentReconciliationService } from "../payment-reconciliation-service";
import { SalesReceiptService } from "../receipt-service";
import { SalesCompletionService } from "../sale-completion-service";
import { SalesDraftService } from "../sale-draft-service";
import { SalesStockService } from "../sale-stock-service";
import { ShiftService } from "../../shifts/nest/shift.service";
import type { DraftInput, PaymentInput, SaleDetail, SaleWithLines } from "../sales-types";

export type { DraftInput, PaymentInput, SaleDetail, SaleWithLines } from "../sales-types";

@Injectable()
export class SalesService {
  private readonly shifts: ShiftService;
  private readonly receipts: SalesReceiptService;
  private readonly providers: SalesPaymentProviderService;
  private readonly reconciliation: SalesPaymentReconciliationService;
  private readonly stock: SalesStockService;
  private readonly drafts: SalesDraftService;
  private readonly completion: SalesCompletionService;
  private readonly lifecycle: SalesLifecycleService;
  private readonly paymongoWebhooks: SalesPayMongoWebhookService;

  constructor(
    @Inject("DbPort") private readonly db: DbPort,
    private readonly paymongo: PayMongoPort = new DisabledPayMongo(),
  ) {
    // Same-DbPort instance (not Nest DI) to avoid a Sales<->Shift DI cycle.
    this.shifts = new ShiftService(db);
    this.stock = new SalesStockService(db);
    this.drafts = new SalesDraftService(db, this.stock);
    this.completion = new SalesCompletionService(db, this.stock, this.shifts);
    this.lifecycle = new SalesLifecycleService(db);
    this.paymongoWebhooks = new SalesPayMongoWebhookService(db, paymongo, this.stock);
    this.receipts = new SalesReceiptService(db);
    this.providers = new SalesPaymentProviderService(db, paymongo, {
      requireSale: (businessId, saleId) => this.requireSale(businessId, saleId),
      embedSale: (sale) => this.embed(sale),
      assertStockAvailable: (businessId, items, branchId) => this.stock.assertAvailable(businessId, items, branchId),
    });
    this.reconciliation = new SalesPaymentReconciliationService(db, {
      requireSale: (businessId, saleId) => this.requireSale(businessId, saleId),
      embedSale: (sale) => this.embed(sale),
      applyStockEffect: (businessId, actorId, requestId, saleId, items, branchId) =>
        this.stock.applySale(businessId, actorId, requestId, saleId, items, branchId),
      postCashSale: async (businessId, actorId, requestId, registerId, saleId, amountMinor) => {
        await this.shifts.postCashSale(businessId, actorId, requestId, registerId, saleId, amountMinor);
      },
      recordSale: (businessId, completedAt) => new BillingService(this.db).recordSale(businessId, completedAt),
    });
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

  isPayMongoConfigured(): boolean {
    return this.paymongo.configured();
  }

  async createDraft(
    businessId: string,
    actorId: string,
    requestId: string,
    input: DraftInput,
    granted: string[],
  ): Promise<DbSale> {
    withScope(businessId, {});
    return this.drafts.createDraft(businessId, actorId, requestId, input, granted);
  }

  async completeSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    input: { payments: PaymentInput[]; key: string; granted: string[]; registerId?: string; branchId?: string | null },
  ): Promise<{ sale: SaleWithLines; replayed: boolean }> {
    withScope(businessId, {});
    return this.completion.completeSale(businessId, actorId, requestId, saleId, input);
  }

  async startPayMongoCheckout(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    method: PayMongoMethod,
    key: string,
    webUrl: string,
  ): Promise<{
    sale: SaleWithLines;
    payment: DbPayment;
    checkoutUrl: string;
    checkoutSessionId: string;
    replayed: boolean;
  }> {
    withScope(businessId, {});
    return this.providers.startPayMongoCheckout(businessId, actorId, requestId, saleId, method, key, webUrl);
  }

  async handlePayMongoWebhook(
    rawBody: string,
    signatureHeader: string | undefined,
    payload: unknown,
    requestId: string,
  ): Promise<{ handled: boolean; deduplicated?: boolean }> {
    return this.paymongoWebhooks.handle(rawBody, signatureHeader, payload, requestId);
  }

  async queryProvider(
    businessId: string,
    paymentId: string,
    provider = "manual",
  ): Promise<{ status: ProviderVerdict }> {
    withScope(businessId, {});
    return this.providers.queryProvider(businessId, paymentId, provider);
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
    return this.reconciliation.reconcilePayment(
      businessId,
      actorId,
      requestId,
      paymentId,
      outcome,
      key,
    );
  }

  async holdSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
  ): Promise<{ id: string }> {
    withScope(businessId, {});
    return this.lifecycle.holdSale(businessId, actorId, requestId, saleId);
  }

  async listHeldSales(
    businessId: string,
    actorId: string,
  ): Promise<{
    items: Array<{
      heldId: string;
      sale: Pick<DbSale, "id" | "status" | "createdAt" | "registerId" | "branchId" | "customerId" | "customerName" | "totalMinor"> & {
        items: Array<Pick<DbSaleItem, "position" | "productId" | "name" | "qty" | "priceMinor">>;
      };
    }>;
  }> {
    withScope(businessId, {});
    const heldRows = await this.db.listHeldSales(businessId, actorId);
    const items: Array<{
      heldId: string;
      sale: Pick<DbSale, "id" | "status" | "createdAt" | "registerId" | "branchId" | "customerId" | "customerName" | "totalMinor"> & {
        items: Array<Pick<DbSaleItem, "position" | "productId" | "name" | "qty" | "priceMinor">>;
      };
    }> = [];

    for (const held of heldRows) {
      if (held.resumedAt !== null) continue;
      const saleId = (held.payload as { saleId?: unknown } | null)?.saleId;
      if (typeof saleId !== "string") continue;
      const sale = await this.db.findSaleById(saleId, businessId);
      if (!sale || sale.actorId !== actorId || sale.status !== "DRAFT") continue;
      const saleItems = await this.db.listSaleItems(sale.id, businessId);
      items.push({
        heldId: held.id,
        sale: {
          id: sale.id,
          status: sale.status,
          createdAt: sale.createdAt,
          registerId: sale.registerId,
          branchId: sale.branchId,
          customerId: sale.customerId,
          customerName: sale.customerName,
          totalMinor: sale.totalMinor,
          items: saleItems
            .map((item) => ({
              position: item.position,
              productId: item.productId,
              name: item.name,
              qty: item.qty,
              priceMinor: item.priceMinor,
            }))
            .sort((a, b) => a.position - b.position),
        },
      });
    }

    items.sort((a, b) => b.sale.createdAt.getTime() - a.sale.createdAt.getTime());
    return { items };
  }

  async resumeSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
  ): Promise<DbSale> {
    withScope(businessId, {});
    return this.lifecycle.resumeSale(businessId, actorId, requestId, saleId);
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
    return this.lifecycle.voidSale(
      businessId,
      actorId,
      requestId,
      saleId,
      reason,
      granted,
    );
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
    return this.lifecycle.requestRefund(
      businessId,
      actorId,
      requestId,
      saleId,
      reason,
      key,
      granted,
    );
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
    return this.receipts.receiptData(businessId, saleId);
  }

  // FR-RECEIPT-01: the downloadable form of the receipt.
  async downloadReceipt(businessId: string, saleId: string): Promise<{ filename: string; text: string }> {
    withScope(businessId, {});
    return this.receipts.downloadReceipt(businessId, saleId);
  }

  // FR-RECEIPT-01: a share link renders the receipt readable without a
  // session; the token is single-secret, hashed at rest, and short-lived.
  async createShareToken(businessId: string, actorId: string, requestId: string, saleId: string): Promise<{ token: string; expiresAt: Date }> {
    withScope(businessId, {});
    return this.receipts.createShareToken(businessId, actorId, requestId, saleId);
  }

  async sharedReceipt(token: string): Promise<{
    receiptNo: string; status: string;
    items: Array<{ name: string; qty: number; lineTotalMinor: number }>;
    subtotalMinor: number; discountMinor: number; taxMinor: number;
    totalMinor: number; paidMinor: number; changeMinor: number;
    tenders: Array<{ method: string; amountMinor: number }>;
  }> {
    return this.receipts.sharedReceipt(token);
  }
}

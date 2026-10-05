import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type {
  DbOrder,
  DbOrderChannel,
  DbOrderPageQuery,
  DbOrderPaymentStatus,
  DbOrderStatus,
  DbPort,
} from "../common/db.port";
import { deriveOrderPaymentStatus } from "./payment-status";
import type { OrderListItem } from "./order-types";

export interface OrderListQuery {
  cursor?: string;
  limit: number;
  status?: DbOrderStatus;
  channel?: DbOrderChannel;
  fulfillmentMode?: "NONE" | "PICKUP" | "DELIVERY";
  branchId?: string;
  paymentStatus?: DbOrderPaymentStatus;
  dateFrom?: string;
  dateTo?: string;
}

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("VALIDATION");
  return date;
}

function encodeCursor(order: Pick<DbOrder, "createdAt" | "id">): string {
  return Buffer.from(JSON.stringify({ createdAt: order.createdAt.toISOString(), id: order.id }), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.id) throw new Error();
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error();
    return { createdAt, id: parsed.id };
  } catch {
    throw new Error("VALIDATION");
  }
}

@Injectable()
export class OrderService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private async paymentStatus(order: DbOrder): Promise<DbOrderPaymentStatus> {
    if (!order.saleId) return "UNPAID";
    const sale = await this.db.findSaleById(order.saleId, order.businessId);
    if (!sale) return "UNPAID";
    const [payments, refunds, refundItems] = await Promise.all([
      this.db.listPaymentsBySale(sale.id, order.businessId),
      this.db.listRefundsBySale(sale.id, order.businessId),
      this.db.listRefundItemsBySale(sale.id, order.businessId),
    ]);
    return deriveOrderPaymentStatus({ sale, payments, refunds, refundItems });
  }

  private async listItem(order: DbOrder): Promise<OrderListItem> {
    return {
      id: order.id,
      businessId: order.businessId,
      channel: order.channel,
      fulfillmentMode: order.fulfillmentMode,
      paymentMode: order.paymentMode,
      branchId: order.branchId,
      contactName: order.contactName,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      deliveryTaxMinor: order.deliveryTaxMinor,
      totalMinor: order.totalMinor,
      saleId: order.saleId,
      status: order.status,
      version: order.version,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      paymentStatus: await this.paymentStatus(order),
    };
  }

  async listOrders(
    businessId: string,
    query: OrderListQuery,
  ): Promise<{ items: OrderListItem[]; nextCursor: string | null }> {
    withScope(businessId, {});
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error("VALIDATION");
    if (query.branchId) {
      const branch = await this.db.findBranchById(query.branchId, businessId);
      if (!branch) throw new Error("VALIDATION");
    }
    const dateFrom = parseDate(query.dateFrom);
    const dateTo = parseDate(query.dateTo);
    if (dateFrom && dateTo && dateTo.getTime() < dateFrom.getTime()) throw new Error("VALIDATION");
    if (dateFrom && dateTo && dateTo.getTime() - dateFrom.getTime() > 366 * 24 * 3600 * 1000) {
      throw new Error("VALIDATION");
    }
    const dbQuery: DbOrderPageQuery = {
      cursor: decodeCursor(query.cursor),
      limit: query.limit + 1,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.fulfillmentMode ? { fulfillmentMode: query.fulfillmentMode } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    };
    const rows = await this.db.listOrdersPage(businessId, dbQuery);
    const page = rows.slice(0, query.limit);
    const items = await Promise.all(page.map((row) => this.listItem(row)));
    return {
      items,
      nextCursor: rows.length > query.limit && page.length ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  async getOrder(businessId: string, id: string, granted: string[]): Promise<{
    order: DbOrder;
    lines: Awaited<ReturnType<DbPort["listOrderLines"]>>;
    reservations: Awaited<ReturnType<DbPort["listReservationsByOrder"]>>;
    fulfillments: Array<Awaited<ReturnType<DbPort["listFulfillmentsByOrder"]>>[number] & {
      lines: Awaited<ReturnType<DbPort["listFulfillmentLines"]>>;
    }>;
    paymentStatus: DbOrderPaymentStatus;
  }> {
    withScope(businessId, {});
    const order = await this.db.findOrderById(id, businessId);
    if (!order) throw new Error("NOT_FOUND");
    const [lines, reservations, fulfillmentRows, paymentStatus] = await Promise.all([
      this.db.listOrderLines(order.id, businessId),
      this.db.listReservationsByOrder(order.id, businessId),
      this.db.listFulfillmentsByOrder(order.id, businessId),
      this.paymentStatus(order),
    ]);
    const canSeeDelivery = granted.includes("order.view_delivery_details");
    const redactFulfillment = (row: typeof fulfillmentRows[number]) => canSeeDelivery ? row : {
      ...row, email: null, phone: null, deliveryAddress: null, instructions: null,
    };
    return {
      order: canSeeDelivery ? order : {
        ...order, email: null, phone: null, deliveryAddress: null, fulfillmentInstructions: null,
      },
      lines,
      reservations,
      fulfillments: await Promise.all(fulfillmentRows.map(async (row) => ({
        ...redactFulfillment(row),
        lines: await this.db.listFulfillmentLines(row.id, businessId),
      }))),
      paymentStatus,
    };
  }
}

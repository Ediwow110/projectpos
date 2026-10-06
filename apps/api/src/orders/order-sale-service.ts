import type {
  DbOrder,
  DbOrderLine,
  DbPort,
  DbSale,
  DbSaleItem,
  DbSaleItemBundleComponent,
} from "../common/db.port";
import { ReservationService } from "./reservation-service";
import { OrderAccessService } from "./order-access-service";

type FrozenBundleComponent = Pick<
  DbSaleItemBundleComponent,
  | "bundleId"
  | "componentProductId"
  | "componentNameSnapshot"
  | "quantityPerBundleSnapshot"
  | "costMinorSnapshot"
  | "compositionVersion"
>;

function parseFrozenComponents(value: unknown | null): FrozenBundleComponent[] {
  if (value === null) return [];
  if (!Array.isArray(value) || value.length === 0) throw new Error("INVALID_BUNDLE_SNAPSHOT");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("INVALID_BUNDLE_SNAPSHOT");
    const row = item as Partial<FrozenBundleComponent>;
    if (
      typeof row.bundleId !== "string" ||
      typeof row.componentProductId !== "string" ||
      typeof row.componentNameSnapshot !== "string" ||
      !Number.isInteger(row.quantityPerBundleSnapshot) ||
      Number(row.quantityPerBundleSnapshot) <= 0 ||
      !Number.isInteger(row.costMinorSnapshot) ||
      Number(row.costMinorSnapshot) < 0 ||
      !Number.isInteger(row.compositionVersion) ||
      Number(row.compositionVersion) <= 0
    ) {
      throw new Error("INVALID_BUNDLE_SNAPSHOT");
    }
    return row as FrozenBundleComponent;
  });
}

function allocateTax(totalTaxMinor: number, items: DbSaleItem[]): number[] {
  if (items.length === 0 || totalTaxMinor <= 0) return items.map(() => 0);
  const bases = items.map((item) => Math.max(0, item.lineTotalMinor));
  const totalBase = bases.reduce((sum, value) => sum + value, 0);
  if (totalBase <= 0) return items.map(() => 0);
  let allocated = 0;
  return items.map((_, index) => {
    const amount = index === items.length - 1
      ? totalTaxMinor - allocated
      : Math.floor(totalTaxMinor * (bases[index] ?? 0) / totalBase);
    allocated += amount;
    return amount;
  });
}

export class OrderSaleService {
  constructor(private readonly db: DbPort) {}

  private async copyOrderLineToSale(
    db: DbPort,
    businessId: string,
    saleId: string,
    line: DbOrderLine,
  ): Promise<void> {
    const saleItem = await db.createSaleItem({
      businessId,
      saleId,
      position: line.position,
      productId: line.productId,
      name: line.name,
      unit: line.unit,
      qty: line.qty,
      priceMinor: line.priceMinor,
      costMinor: line.costMinor,
      taxRateBps: line.taxRateBps,
      lineDiscountMinor: line.discountMinor,
      lineTotalMinor: Math.max(0, line.qty * line.priceMinor - line.discountMinor),
    });
    for (const component of parseFrozenComponents(line.bundleComponentsSnapshot)) {
      await db.createSaleItemBundleComponent({
        businessId,
        saleItemId: saleItem.id,
        ...component,
      });
    }
  }

  private async createSaleFromSubmittedOrderLocked(
    db: DbPort,
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
  ): Promise<DbSale> {
    const order = await db.findOrderById(orderId, businessId);
    if (!order) throw new Error("NOT_FOUND");
    const eligibleWebOrder =
      order.channel === "WEB"
      && (
        order.status === "SUBMITTED"
        || (order.status === "CONFIRMED" && order.paymentMode === "PAY_AT_PICKUP")
      );
    if (!eligibleWebOrder) throw new Error("INVALID_STATE");
    if (order.saleId) {
      const existing = await db.findSaleById(order.saleId, businessId);
      if (!existing) throw new Error("CONFLICT");
      return existing;
    }
    const lines = await db.listOrderLines(order.id, businessId);
    if (lines.length === 0) throw new Error("VALIDATION");
    const receiptNo = await db.nextReceiptNo(businessId);
    const sale = await db.createSale({
      businessId,
      receiptNo,
      status: "DRAFT",
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      deliveryTaxMinor: order.deliveryTaxMinor,
      totalMinor: order.totalMinor,
      paidMinor: 0,
      changeMinor: 0,
      currency: order.currency,
      customerId: null,
      customerName: order.contactName,
      notes: order.fulfillmentInstructions,
      actorId,
      requestId,
      idempotencyKey: null,
      registerId: null,
      branchId: order.branchId,
      completedAt: null,
      voidedAt: null,
      voidReason: null,
      createdAt: new Date(),
    });
    for (const line of lines) await this.copyOrderLineToSale(db, businessId, sale.id, line);
    const linked = await db.updateOrder(order.id, businessId, { saleId: sale.id }, order.version);
    if (!linked) throw new Error("STALE_VERSION");
    await db.appendAudit({
      businessId,
      actorId,
      action: "order.sale-linked",
      entityType: "Order",
      entityId: order.id,
      requestId,
      after: { saleId: sale.id },
    });
    return sale;
  }

  async createSaleFromSubmittedOrder(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
  ): Promise<DbSale> {
    return this.db.withLock("sales:" + businessId, () =>
      this.db.withTransaction((tx) =>
        this.createSaleFromSubmittedOrderLocked(tx, businessId, actorId, requestId, orderId),
      ),
    );
  }

  async createPosOrderForSaleLocked(
    db: DbPort,
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
  ): Promise<DbOrder> {
    const existing = await db.findOrderBySaleId(saleId, businessId);
    if (existing) return existing;
    const sale = await db.findSaleById(saleId, businessId);
    if (!sale) throw new Error("NOT_FOUND");
    const saleItems = await db.listSaleItems(sale.id, businessId);
    if (saleItems.length === 0) throw new Error("VALIDATION");
    const now = new Date();
    const order = await db.createOrder({
      businessId,
      channel: "POS",
      fulfillmentMode: "NONE",
      paymentMode: "POS",
      branchId: sale.branchId ?? null,
      customerId: sale.customerId,
      contactName: sale.customerName,
      email: null,
      phone: null,
      deliveryAddress: null,
      fulfillmentInstructions: null,
      currency: sale.currency,
      subtotalMinor: sale.subtotalMinor,
      discountMinor: sale.discountMinor,
      taxMinor: sale.taxMinor,
      deliveryFeeMinor: sale.deliveryFeeMinor,
      deliveryTaxMinor: sale.deliveryTaxMinor,
      totalMinor: sale.totalMinor,
      saleId: sale.id,
      status: "CONFIRMED",
      version: 1,
      checkoutAt: now,
      submittedAt: now,
      confirmedAt: now,
      completedAt: null,
      cancelledAt: null,
      actorId,
      requestId,
      createdAt: now,
      updatedAt: now,
    });
    const taxAllocations = allocateTax(sale.taxMinor, saleItems);
    for (const [position, item] of saleItems.entries()) {
      const product = await db.findProductById(item.productId, businessId);
      const bundleComponents = await db.listSaleItemBundleComponents(item.id, businessId);
      await db.createOrderLine({
        businessId,
        orderId: order.id,
        position,
        productId: item.productId,
        name: item.name,
        sku: product?.sku ?? null,
        barcode: product?.barcode ?? null,
        unit: item.unit,
        qty: item.qty,
        priceMinor: item.priceMinor,
        costMinor: item.costMinor,
        taxRateBps: item.taxRateBps,
        discountMinor: item.lineDiscountMinor,
        taxMinor: taxAllocations[position] ?? 0,
        lineTotalMinor: item.lineTotalMinor,
        bundleComponentsSnapshot: bundleComponents.length
          ? bundleComponents.map((component) => ({
              bundleId: component.bundleId,
              componentProductId: component.componentProductId,
              componentNameSnapshot: component.componentNameSnapshot,
              quantityPerBundleSnapshot: component.quantityPerBundleSnapshot,
              costMinorSnapshot: component.costMinorSnapshot,
              compositionVersion: component.compositionVersion,
            }))
          : null,
        createdAt: now,
      });
    }
    return order;
  }

  async createPosOrderForSale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
  ): Promise<DbOrder> {
    return this.db.withLock("sales:" + businessId, () =>
      this.db.withTransaction((tx) =>
        this.createPosOrderForSaleLocked(tx, businessId, actorId, requestId, saleId),
      ),
    );
  }

  async settleLinkedSaleLocked(
    db: DbPort,
    businessId: string,
    saleId: string,
    completedAt: Date,
  ): Promise<DbOrder | null> {
    const order = await db.findOrderBySaleId(saleId, businessId);
    if (!order) return null;
    if (order.channel === "WEB") {
      if (order.status !== "SUBMITTED" && order.status !== "CONFIRMED") throw new Error("INVALID_STATE");
      await new ReservationService(db).commitForSaleLocked(db, businessId, order.id, saleId);
      if (order.status === "CONFIRMED") return order;
      const confirmed = await db.updateOrder(
        order.id,
        businessId,
        { status: "CONFIRMED", confirmedAt: completedAt },
        order.version,
      );
      if (!confirmed) throw new Error("STALE_VERSION");
      await new OrderAccessService(db).revokeCheckoutTokens(businessId, order.id, completedAt);
      return confirmed;
    }
    if (order.channel === "POS") {
      if (order.status === "COMPLETED") return order;
      if (order.status !== "CONFIRMED") throw new Error("INVALID_STATE");
      const completed = await db.updateOrder(
        order.id,
        businessId,
        { status: "COMPLETED", completedAt },
        order.version,
      );
      if (!completed) throw new Error("STALE_VERSION");
      return completed;
    }
    return order;
  }

  async cancelPosOrderForVoidedSaleLocked(
    db: DbPort,
    businessId: string,
    saleId: string,
    cancelledAt: Date,
  ): Promise<DbOrder | null> {
    const order = await db.findOrderBySaleId(saleId, businessId);
    if (!order || order.channel !== "POS") return order;
    if (order.status === "CANCELLED") return order;
    if (order.status !== "CONFIRMED") throw new Error("INVALID_STATE");
    const cancelled = await db.updateOrder(
      order.id,
      businessId,
      { status: "CANCELLED", cancelledAt },
      order.version,
    );
    if (!cancelled) throw new Error("STALE_VERSION");
    return cancelled;
  }
}

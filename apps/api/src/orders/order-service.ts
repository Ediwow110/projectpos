import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type {
  DbBusiness,
  DbOrder,
  DbOrderChannel,
  DbOrderPageQuery,
  DbOrderPaymentStatus,
  DbOrderStatus,
  DbPort,
  DbProduct,
} from "../common/db.port";
import { InventoryAvailabilityService } from "../inventory/availability-service";
import { computeSaleTotals, computeTaxMinor } from "../sales/totals";
import { fingerprintPayload } from "../sales/idempotency";
import { transitionOrder } from "./order-state";
import { ReservationService } from "./reservation-service";
import { OrderAccessService } from "./order-access-service";
import { normalizeOrderEmail, normalizeOrderPhone } from "./order-contact";
import { FulfillmentService } from "./fulfillment-service";
import type { OrderNotificationService } from "./order-notification-service";
import { withInventoryLocks } from "../inventory/inventory-locks";
import { deriveOrderPaymentStatus } from "./payment-status";
import type { OrderListItem } from "./order-types";
import { recordIdempotencyConflict, recordOrderLifecycle } from "../common/metrics";

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

function orderIdempotencyMismatch(): never {
  recordIdempotencyConflict("order");
  throw new Error("IDEMPOTENCY_MISMATCH");
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
  constructor(
    @Inject("DbPort") private readonly db: DbPort,
    private readonly notifications?: OrderNotificationService,
  ) {}

  private async reservationRequirements(db: DbPort, businessId: string, orderId: string): Promise<Map<string, number>> {
    const required = new Map<string, number>();
    for (const line of await db.listOrderLines(orderId, businessId)) {
      if (line.bundleComponentsSnapshot !== null) {
        if (!Array.isArray(line.bundleComponentsSnapshot) || line.bundleComponentsSnapshot.length === 0) {
          throw new Error("INVALID_BUNDLE_SNAPSHOT");
        }
        for (const raw of line.bundleComponentsSnapshot) {
          const component = raw as { componentProductId?: unknown; quantityPerBundleSnapshot?: unknown };
          if (
            typeof component.componentProductId !== "string"
            || !Number.isInteger(component.quantityPerBundleSnapshot)
            || Number(component.quantityPerBundleSnapshot) <= 0
          ) throw new Error("INVALID_BUNDLE_SNAPSHOT");
          required.set(
            component.componentProductId,
            (required.get(component.componentProductId) ?? 0) + line.qty * Number(component.quantityPerBundleSnapshot),
          );
        }
      } else {
        const product = await db.findProductById(line.productId, businessId);
        if (!product) throw new Error("NOT_FOUND");
        if (product.trackInventory) {
          required.set(line.productId, (required.get(line.productId) ?? 0) + line.qty);
        }
      }
    }
    return required;
  }

  async acceptPayAtPickup(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    expectedVersion: number,
    key: string,
    now: Date = new Date(),
  ): Promise<DbOrder> {
    const fingerprint = fingerprintPayload({ orderId, expectedVersion });
    const result = await this.db.withLock("sales:" + businessId, () =>
      this.db.withTransaction(async (tx) => {
        const replay = await tx.findIdempotency(businessId, key, "order.accept");
        if (replay) {
          if (replay.fingerprint !== fingerprint) orderIdempotencyMismatch();
          const row = await tx.findOrderById(orderId, businessId);
          if (!row) throw new Error("NOT_FOUND");
          return { order: row, notify: false };
        }
        const order = await tx.findOrderById(orderId, businessId);
        if (!order) throw new Error("NOT_FOUND");
        if (
          order.version !== expectedVersion
          || order.channel !== "WEB"
          || order.fulfillmentMode !== "PICKUP"
          || order.paymentMode !== "PAY_AT_PICKUP"
          || order.status !== "SUBMITTED"
          || !order.branchId
        ) throw new Error(order.version !== expectedVersion ? "STALE_VERSION" : "INVALID_STATE");
        const expected = await this.reservationRequirements(tx, businessId, order.id);
        const held = (await tx.listReservationsByOrder(order.id, businessId)).filter((row) => row.status === "HELD");
        const actual = new Map<string, number>();
        for (const row of held) {
          if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) throw new Error("RESERVATION_EXPIRED");
          actual.set(row.productId, (actual.get(row.productId) ?? 0) + row.qty);
        }
        if (
          expected.size !== actual.size
          || [...expected].some(([productId, qty]) => actual.get(productId) !== qty)
        ) throw new Error("RESERVATION_CONFLICT");
        const targets = held.map((row) => ({ productId: row.productId, branchId: row.branchId }));
        return withInventoryLocks(tx, businessId, targets, async () => {
          const currentHeld = (await tx.listReservationsByOrder(order.id, businessId)).filter((row) => row.status === "HELD");
          if (currentHeld.length !== held.length || currentHeld.some((row) => row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())) {
            throw new Error("RESERVATION_EXPIRED");
          }
          for (const row of currentHeld) {
            const updated = await tx.updateInventoryReservation(row.id, businessId, { expiresAt: null });
            if (!updated) throw new Error("RESERVATION_CONFLICT");
          }
          const confirmed = await tx.updateOrder(order.id, businessId, {
            status: transitionOrder(order.status, "CONFIRMED"),
            confirmedAt: now,
          }, order.version);
          if (!confirmed) throw new Error("STALE_VERSION");
          const lines = await tx.listOrderLines(order.id, businessId);
          await new FulfillmentService(tx).createFulfillment(
            businessId,
            order.id,
            "PICKUP",
            order.branchId!,
            lines.map((line) => ({ orderLineId: line.id, qty: line.qty })),
          );
          await tx.claimIdempotency({ businessId, key, commandType: "order.accept", fingerprint, resultId: order.id });
          await tx.appendAudit({
            businessId, actorId, action: "order.accept", entityType: "Order",
            entityId: order.id, requestId,
          });
          return { order: confirmed, notify: true };
        });
      }),
    );
    if (result.notify && this.notifications) await this.notifications.sendEvent(businessId, orderId, "CONFIRMED");
    if (result.notify) recordOrderLifecycle("WEB", "CONFIRMED");
    return result.order;
  }

  async rejectOrder(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    expectedVersion: number,
    key: string,
    reason?: string,
  ): Promise<DbOrder> {
    const cleanReason = reason?.trim() || null;
    const fingerprint = fingerprintPayload({ orderId, expectedVersion, reason: cleanReason });
    return this.db.withLock("sales:" + businessId, () =>
      this.db.withTransaction(async (tx) => {
        const replay = await tx.findIdempotency(businessId, key, "order.reject");
        if (replay) {
          if (replay.fingerprint !== fingerprint) orderIdempotencyMismatch();
          const row = await tx.findOrderById(orderId, businessId);
          if (!row) throw new Error("NOT_FOUND");
          return row;
        }
        const order = await tx.findOrderById(orderId, businessId);
        if (!order) throw new Error("NOT_FOUND");
        if (order.version !== expectedVersion) throw new Error("STALE_VERSION");
        if (order.status !== "SUBMITTED" || (await tx.listFulfillmentsByOrder(order.id, businessId)).length > 0) {
          throw new Error("INVALID_STATE");
        }
        await new ReservationService(tx).releaseOrderLocked(tx, businessId, order.id, "RELEASED");
        const next = await tx.updateOrder(order.id, businessId, { status: "REJECTED" }, order.version);
        if (!next) throw new Error("STALE_VERSION");
        await tx.claimIdempotency({ businessId, key, commandType: "order.reject", fingerprint, resultId: order.id });
        await tx.appendAudit({
          businessId, actorId, action: "order.reject", entityType: "Order",
          entityId: order.id, requestId, reason: cleanReason ?? undefined,
        });
        recordOrderLifecycle(order.channel, "REJECTED");
        return next;
      }),
    );
  }

  async cancelOrder(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    expectedVersion: number,
    key: string,
    reason?: string,
    returnedToMerchant = false,
  ): Promise<DbOrder> {
    const cleanReason = reason?.trim() || null;
    const fingerprint = fingerprintPayload({ orderId, expectedVersion, reason: cleanReason, returnedToMerchant });
    return this.db.withLock("sales:" + businessId, () =>
      this.db.withTransaction(async (tx) => {
        const replay = await tx.findIdempotency(businessId, key, "order.cancel");
        if (replay) {
          if (replay.fingerprint !== fingerprint) orderIdempotencyMismatch();
          const row = await tx.findOrderById(orderId, businessId);
          if (!row) throw new Error("NOT_FOUND");
          return row;
        }
        const order = await tx.findOrderById(orderId, businessId);
        if (!order) throw new Error("NOT_FOUND");
        if (order.version !== expectedVersion) throw new Error("STALE_VERSION");
        if (order.status !== "CONFIRMED") throw new Error("INVALID_STATE");
        const fulfillments = await tx.listFulfillmentsByOrder(order.id, businessId);
        if (fulfillments.some((row) => ["COLLECTED", "DELIVERED"].includes(row.status))) throw new Error("INVALID_STATE");
        if (order.saleId) {
          const sale = await tx.findSaleById(order.saleId, businessId);
          if (!sale) throw new Error("CONFLICT");
          if (["COMPLETED", "PAID", "PARTIALLY_REFUNDED", "REFUND_REQUESTED", "PAYMENT_UNKNOWN", "RECONCILED"].includes(sale.status)) {
            throw new Error("FULL_REFUND_REQUIRED");
          }
          if (sale.status === "REFUNDED") {
            // already financially reversed; proceed
          } else if (!["DRAFT", "PENDING_PAYMENT", "PAYMENT_FAILED", "PAYMENT_UNKNOWN", "RECONCILED", "VOIDED"].includes(sale.status)) {
            throw new Error("FULL_REFUND_REQUIRED");
          }
        }
        await new ReservationService(tx).releaseOrderLocked(tx, businessId, order.id, "RELEASED");
        for (const fulfillment of fulfillments) {
          if (fulfillment.status === "CANCELLED") continue;
          if (fulfillment.status === "DISPATCHED") throw new Error("INVALID_STATE");
          if (fulfillment.status === "DELIVERY_FAILED" && !returnedToMerchant) throw new Error("RETURN_TO_MERCHANT_REQUIRED");
          await tx.updateFulfillment(fulfillment.id, businessId, {
            status: "CANCELLED",
            cancelledAt: new Date(),
          }, fulfillment.version);
        }
        const next = await tx.updateOrder(order.id, businessId, {
          status: transitionOrder(order.status, "CANCELLED"),
          cancelledAt: new Date(),
        }, order.version);
        if (!next) throw new Error("STALE_VERSION");
        await tx.claimIdempotency({ businessId, key, commandType: "order.cancel", fingerprint, resultId: order.id });
        await tx.appendAudit({
          businessId, actorId, action: "order.cancel", entityType: "Order",
          entityId: order.id, requestId, reason: cleanReason ?? undefined,
        });
        recordOrderLifecycle(order.channel, "CANCELLED");
        return next;
      }),
    );
  }

  async linkCustomer(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    customerId: string,
    expectedVersion: number,
    role: string,
    key: string,
    overrideReason?: string,
  ): Promise<DbOrder> {
    const cleanReason = overrideReason?.trim() || null;
    const fingerprint = fingerprintPayload({ orderId, customerId, expectedVersion, overrideReason: cleanReason });
    return this.db.withLock("order-link:" + businessId + ":" + orderId, () =>
      this.db.withTransaction(async (tx) => {
        const replay = await tx.findIdempotency(businessId, key, "order.link_customer");
        if (replay) {
          if (replay.fingerprint !== fingerprint) orderIdempotencyMismatch();
          const row = await tx.findOrderById(orderId, businessId);
          if (!row) throw new Error("NOT_FOUND");
          return row;
        }
        const order = await tx.findOrderById(orderId, businessId);
        const customer = await tx.findCustomerById(customerId, businessId);
        if (!order || !customer?.isActive) throw new Error("NOT_FOUND");
        if (order.version !== expectedVersion) throw new Error("STALE_VERSION");
        const emailMatch = Boolean(
          order.email && customer.email
          && normalizeOrderEmail(order.email) === normalizeOrderEmail(customer.email),
        );
        let phoneMatch = false;
        if (order.phone && customer.phone) {
          try { phoneMatch = normalizeOrderPhone(order.phone) === normalizeOrderPhone(customer.phone); }
          catch { phoneMatch = false; }
        }
        const matched = emailMatch || phoneMatch;
        let reason: string | null = null;
        if (!matched) {
          if (!["owner", "manager"].includes(role)) throw new Error("CUSTOMER_VERIFICATION_REQUIRED");
          reason = cleanReason ?? "";
          if (reason.length < 3 || reason.length > 500) throw new Error("VALIDATION");
        }
        const next = await tx.updateOrder(order.id, businessId, { customerId }, order.version);
        if (!next) throw new Error("STALE_VERSION");
        await tx.claimIdempotency({
          businessId,
          key,
          commandType: "order.link_customer",
          fingerprint,
          resultId: order.id,
        });
        await tx.appendAudit({
          businessId, actorId, action: "order.link_customer", entityType: "Order",
          entityId: order.id, requestId, reason: reason ?? undefined, after: { customerId, matched },
        });
        return next;
      }),
    );
  }

  async resendAccess(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    key: string,
  ): Promise<{ sent: boolean; replayed: boolean }> {
    const fingerprint = fingerprintPayload({ orderId });
    return this.db.withLock("order-access:" + businessId + ":" + orderId, async () => {
      const replay = await this.db.findIdempotency(businessId, key, "order.access.resend");
      if (replay) {
        if (replay.fingerprint !== fingerprint) orderIdempotencyMismatch();
        return { sent: replay.resultId === "sent", replayed: true };
      }
      if (!this.notifications) throw new Error("EMAIL_DELIVERY_FAILED");
      const sent = await this.notifications.resend(businessId, orderId);
      await this.db.claimIdempotency({
        businessId,
        key,
        commandType: "order.access.resend",
        fingerprint,
        resultId: sent ? "sent" : "not-sent",
      });
      await this.db.appendAudit({
        businessId, actorId, action: "order.access.resend", entityType: "Order",
        entityId: orderId, requestId, after: { sent },
      });
      return { sent, replayed: false };
    });
  }

  async revokeAccess(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    key: string,
  ): Promise<{ revoked: number; replayed: boolean }> {
    const fingerprint = fingerprintPayload({ orderId });
    return this.db.withLock("order-access:" + businessId + ":" + orderId, async () => {
      const replay = await this.db.findIdempotency(businessId, key, "order.access.revoke");
      if (replay) {
        if (replay.fingerprint !== fingerprint) orderIdempotencyMismatch();
        return { revoked: Number(replay.resultId) || 0, replayed: true };
      }
      const revoked = this.notifications
        ? await this.notifications.revoke(businessId, orderId)
        : await new OrderAccessService(this.db).revokeStatusTokens(businessId, orderId);
      await this.db.claimIdempotency({
        businessId,
        key,
        commandType: "order.access.revoke",
        fingerprint,
        resultId: String(revoked),
      });
      await this.db.appendAudit({
        businessId, actorId, action: "order.access.revoke", entityType: "Order",
        entityId: orderId, requestId, after: { revoked },
      });
      return { revoked, replayed: false };
    });
  }

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

  private async storefront(key: string): Promise<{ business: DbBusiness; settings: Record<string, unknown> }> {
    const business = await this.db.findBusinessByStorefrontKey(key);
    if (!business) throw new Error("NOT_FOUND");
    const settings = await this.db.getSettings(business.id);
    if (settings["onlineOrderingEnabled"] !== true) throw new Error("NOT_FOUND");
    return { business, settings };
  }

  private configuredBranchIds(settings: Record<string, unknown>): Set<string> {
    const pickup = Array.isArray(settings["onlinePickupBranchIds"])
      ? settings["onlinePickupBranchIds"].filter((value): value is string => typeof value === "string")
      : [];
    const delivery = typeof settings["onlineFulfillmentBranchId"] === "string"
      ? [settings["onlineFulfillmentBranchId"]]
      : [];
    return new Set([...pickup, ...delivery]);
  }

  private async assertPublicBranch(
    db: DbPort,
    businessId: string,
    settings: Record<string, unknown>,
    branchId: string,
    mode: "PICKUP" | "DELIVERY",
  ): Promise<void> {
    const branch = await db.findBranchById(branchId, businessId);
    if (!branch?.isActive) throw new Error("VALIDATION");
    if (mode === "PICKUP") {
      const ids = Array.isArray(settings["onlinePickupBranchIds"]) ? settings["onlinePickupBranchIds"] : [];
      if (!ids.includes(branchId)) throw new Error("VALIDATION");
    } else if (settings["onlineFulfillmentBranchId"] !== branchId) {
      throw new Error("VALIDATION");
    }
  }

  private async availableForProduct(
    db: DbPort,
    businessId: string,
    branchId: string,
    product: DbProduct,
  ): Promise<number | null> {
    const availability = new InventoryAvailabilityService(db);
    if (product.productType === "BUNDLE") {
      const bundle = await db.findProductBundleByProductId(product.id, businessId);
      if (!bundle) return 0;
      const components = await db.listBundleComponents(bundle.id, businessId);
      if (components.length === 0) return 0;
      let available = Number.MAX_SAFE_INTEGER;
      for (const component of components) {
        const componentProduct = await db.findProductById(component.componentProductId, businessId);
        if (!componentProduct?.trackInventory) continue;
        const qty = await availability.availableToSell(businessId, branchId, component.componentProductId);
        available = Math.min(available, Math.floor(qty / component.quantity));
      }
      return available === Number.MAX_SAFE_INTEGER ? null : available;
    }
    if (!product.trackInventory) return null;
    return availability.availableToSell(businessId, branchId, product.id);
  }

  async publicStorefront(key: string) {
    const { business, settings } = await this.storefront(key);
    const ids = this.configuredBranchIds(settings);
    const branches = [];
    for (const id of ids) {
      const branch = await this.db.findBranchById(id, business.id);
      if (branch?.isActive) branches.push({ id: branch.id, name: branch.name });
    }
    const pickupIds = new Set(
      Array.isArray(settings["onlinePickupBranchIds"])
        ? settings["onlinePickupBranchIds"].filter((value): value is string => typeof value === "string")
        : [],
    );
    const deliveryBranchId =
      typeof settings["onlineFulfillmentBranchId"] === "string"
        ? settings["onlineFulfillmentBranchId"]
        : null;
    const deliveryBranch = deliveryBranchId
      ? branches.find((branch) => branch.id === deliveryBranchId) ?? null
      : null;
    return {
      name: business.name,
      currency: business.currency,
      pickupBranches: branches.filter((branch) => pickupIds.has(branch.id)),
      deliveryAvailable: deliveryBranch !== null,
      deliveryBranch,
      deliveryFlatFeeMinor:
        typeof settings["deliveryFlatFeeMinor"] === "number" ? settings["deliveryFlatFeeMinor"] : 0,
      taxRateBps: typeof settings["taxRateBps"] === "number" ? settings["taxRateBps"] : null,
      taxName: typeof settings["taxName"] === "string" ? settings["taxName"] : null,
    };
  }

  async publicCatalog(
    key: string,
    query: { branchId: string; q?: string; categoryId?: string; page: number; pageSize: number },
  ) {
    const { business, settings } = await this.storefront(key);
    if (!this.configuredBranchIds(settings).has(query.branchId)) throw new Error("VALIDATION");
    const branch = await this.db.findBranchById(query.branchId, business.id);
    if (!branch?.isActive) throw new Error("VALIDATION");
    if (query.categoryId && !(await this.db.findCategoryById(query.categoryId, business.id))) throw new Error("VALIDATION");
    const needle = query.q?.trim().toLowerCase() ?? "";
    const rows = (await this.db.listProducts(business.id))
      .filter((product) => product.isActive)
      .filter((product) => !query.categoryId || product.categoryId === query.categoryId)
      .filter((product) => !needle || [product.name, product.sku ?? "", product.brand ?? ""].some((value) => value.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    const items = await Promise.all(rows.slice(start, start + query.pageSize).map(async (product) => ({
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      sku: product.sku,
      brand: product.brand,
      unit: product.unit,
      priceMinor: product.priceMinor,
      taxRateBps: product.taxRateBps,
      imageUrl: product.imageUrl,
      productType: product.productType ?? "STANDARD",
      availableToSell: await this.availableForProduct(this.db, business.id, query.branchId, product),
    })));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async createPublicDraft(
    storefrontKey: string,
    idempotencyKey: string,
    requestId: string,
    now: Date = new Date(),
  ): Promise<{ order: DbOrder; checkoutToken: string; replayed: boolean }> {
    const { business } = await this.storefront(storefrontKey);
    const fingerprint = fingerprintPayload({ storefrontKey });
    return this.db.withLock("orders-public-create:" + business.id, async () => {
      const existing = await this.db.findIdempotency(business.id, idempotencyKey, "order.public.create");
      if (existing) {
        if (existing.fingerprint !== fingerprint) orderIdempotencyMismatch();
        const order = await this.db.findOrderById(existing.resultId, business.id);
        if (!order) throw new Error("NOT_FOUND");
        const access = new OrderAccessService(this.db);
        await access.revokeAll(business.id, order.id, "CHECKOUT", now);
        const minted = await access.mint(business.id, order.id, "CHECKOUT", new Date(now.getTime() + 2 * 60 * 60_000), now);
        return { order, checkoutToken: minted.token, replayed: true };
      }
      const order = await this.db.createOrder({
        businessId: business.id,
        channel: "WEB",
        fulfillmentMode: "PICKUP",
        paymentMode: "PREPAID",
        branchId: null,
        customerId: null,
        contactName: null,
        email: null,
        phone: null,
        deliveryAddress: null,
        fulfillmentInstructions: null,
        currency: business.currency,
        subtotalMinor: 0,
        discountMinor: 0,
        taxMinor: 0,
        deliveryFeeMinor: 0,
        deliveryTaxMinor: 0,
        totalMinor: 0,
        saleId: null,
        status: "DRAFT",
        version: 1,
        checkoutAt: null,
        submittedAt: null,
        confirmedAt: null,
        completedAt: null,
        cancelledAt: null,
        actorId: "public",
        requestId,
        createdAt: now,
        updatedAt: now,
      });
      const minted = await new OrderAccessService(this.db).mint(
        business.id,
        order.id,
        "CHECKOUT",
        new Date(now.getTime() + 2 * 60 * 60_000),
        now,
      );
      await this.db.claimIdempotency({
        businessId: business.id,
        key: idempotencyKey,
        commandType: "order.public.create",
        fingerprint,
        resultId: order.id,
      });
      return { order, checkoutToken: minted.token, replayed: false };
    });
  }

  private async draftLine(
    db: DbPort,
    businessId: string,
    orderId: string,
    position: number,
    productId: string,
    qty: number,
    createdAt: Date,
    businessTaxRateBps: number | null,
  ) {
    const product = await db.findProductById(productId, businessId);
    if (!product?.isActive) throw new Error("NOT_FOUND");
    let bundleComponentsSnapshot: unknown | null = null;
    if (product.productType === "BUNDLE") {
      const bundle = await db.findProductBundleByProductId(product.id, businessId);
      if (!bundle) throw new Error("INVALID_BUNDLE");
      const components = await db.listBundleComponents(bundle.id, businessId);
      if (components.length === 0) throw new Error("INVALID_BUNDLE");
      bundleComponentsSnapshot = await Promise.all(components.map(async (component) => {
        const source = await db.findProductById(component.componentProductId, businessId);
        if (!source?.isActive) throw new Error("INVALID_BUNDLE_COMPONENT");
        return {
          bundleId: bundle.id,
          componentProductId: source.id,
          componentNameSnapshot: source.name,
          quantityPerBundleSnapshot: component.quantity,
          costMinorSnapshot: source.costMinor,
          compositionVersion: bundle.version,
        };
      }));
    }
    const taxRate = product.taxRateBps ?? businessTaxRateBps;
    return db.createOrderLine({
      businessId,
      orderId,
      position,
      productId: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      unit: product.unit,
      qty,
      priceMinor: product.priceMinor,
      costMinor: product.costMinor,
      taxRateBps: product.taxRateBps,
      discountMinor: 0,
      taxMinor: computeTaxMinor(product.priceMinor * qty, taxRate),
      lineTotalMinor: product.priceMinor * qty,
      bundleComponentsSnapshot,
      createdAt,
    });
  }

  async patchPublicDraft(
    businessId: string,
    orderId: string,
    input: { branchId: string; fulfillmentMode: "PICKUP" | "DELIVERY"; lines: Array<{ productId: string; qty: number }> },
  ): Promise<DbOrder> {
    const settings = await this.db.getSettings(businessId);
    await this.assertPublicBranch(this.db, businessId, settings, input.branchId, input.fulfillmentMode);
    return this.db.withLock("order:" + businessId + ":" + orderId, () =>
      this.db.withTransaction(async (tx) => {
        const order = await tx.findOrderById(orderId, businessId);
        if (!order || order.status !== "DRAFT") throw new Error("INVALID_STATE");
        const updated = await tx.updateOrder(order.id, businessId, {
          branchId: input.branchId,
          fulfillmentMode: input.fulfillmentMode,
        }, order.version);
        if (!updated) throw new Error("STALE_VERSION");
        await tx.deleteOrderLines(order.id, businessId);
        const rate = typeof settings["taxRateBps"] === "number" ? settings["taxRateBps"] : null;
        for (const [position, line] of input.lines.entries()) {
          await this.draftLine(tx, businessId, order.id, position, line.productId, line.qty, new Date(), rate);
        }
        return updated;
      }),
    );
  }

  async submitPublicOrder(
    businessId: string,
    orderId: string,
    input: {
      branchId: string;
      fulfillmentMode: "PICKUP" | "DELIVERY";
      paymentMode: "PREPAID" | "PAY_AT_PICKUP";
      paymentMethod?: "card" | "gcash" | "maya" | "qrph";
      contactName: string;
      email: string;
      phone: string;
      deliveryAddress?: unknown | null;
      fulfillmentInstructions?: string | null;
    },
    idempotencyKey: string,
    requestId: string,
    now: Date = new Date(),
  ): Promise<{ order: DbOrder; statusToken: string; replayed: boolean }> {
    const fingerprint = fingerprintPayload(input);
    return this.db.withLock("sales:" + businessId, () =>
      this.db.withTransaction(async (tx) => {
        const existing = await tx.findIdempotency(businessId, idempotencyKey, "order.public.submit");
        if (existing) {
          if (existing.fingerprint !== fingerprint) orderIdempotencyMismatch();
          const order = await tx.findOrderById(existing.resultId, businessId);
          if (!order) throw new Error("NOT_FOUND");
          const minted = await new OrderAccessService(tx).mint(
            businessId, order.id, "STATUS", new Date(now.getTime() + 30 * 24 * 60 * 60_000), now,
          );
          return { order, statusToken: minted.token, replayed: true };
        }
        const order = await tx.findOrderById(orderId, businessId);
        if (!order || order.status !== "DRAFT") throw new Error("INVALID_STATE");
        const settings = await tx.getSettings(businessId);
        if (settings["onlineOrderingEnabled"] !== true) throw new Error("NOT_FOUND");
        await this.assertPublicBranch(tx, businessId, settings, input.branchId, input.fulfillmentMode);
        if (input.fulfillmentMode === "DELIVERY" && input.paymentMode !== "PREPAID") throw new Error("VALIDATION");
        if (input.fulfillmentMode === "DELIVERY" && !input.deliveryAddress) throw new Error("VALIDATION");
        if (input.paymentMode === "PREPAID" && !input.paymentMethod) throw new Error("VALIDATION");
        if (input.paymentMode === "PAY_AT_PICKUP" && input.fulfillmentMode !== "PICKUP") throw new Error("VALIDATION");
        const currentLines = await tx.listOrderLines(order.id, businessId);
        if (currentLines.length === 0) throw new Error("VALIDATION");
        const rate = typeof settings["taxRateBps"] === "number" ? settings["taxRateBps"] : null;
        await tx.deleteOrderLines(order.id, businessId);
        const frozen = [];
        for (const [position, line] of currentLines.entries()) {
          frozen.push(await this.draftLine(tx, businessId, order.id, position, line.productId, line.qty, now, rate));
        }
        const totals = computeSaleTotals({
          lines: frozen.map((line) => ({
            qty: line.qty, priceMinor: line.priceMinor, costMinor: line.costMinor,
            taxRateBps: line.taxRateBps, lineDiscountMinor: line.discountMinor,
          })),
          orderDiscountMinor: 0,
          businessTaxRateBps: rate,
        });
        const deliveryFeeMinor = input.fulfillmentMode === "DELIVERY" && typeof settings["deliveryFlatFeeMinor"] === "number"
          ? settings["deliveryFlatFeeMinor"] : 0;
        const deliveryTaxMinor = computeTaxMinor(deliveryFeeMinor, rate);
        const checkout = await tx.updateOrder(order.id, businessId, {
          status: transitionOrder(order.status, "CHECKOUT"),
          checkoutAt: now,
          branchId: input.branchId,
          fulfillmentMode: input.fulfillmentMode,
          paymentMode: input.paymentMode,
          contactName: input.contactName.trim(),
          email: normalizeOrderEmail(input.email),
          phone: normalizeOrderPhone(input.phone),
          deliveryAddress: input.fulfillmentMode === "DELIVERY" ? (input.deliveryAddress ?? null) : null,
          fulfillmentInstructions: input.fulfillmentInstructions?.trim() || null,
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor,
          deliveryFeeMinor,
          deliveryTaxMinor,
          totalMinor: totals.totalMinor + deliveryFeeMinor + deliveryTaxMinor,
          requestId,
        }, order.version);
        if (!checkout) throw new Error("STALE_VERSION");
        const submitted = await tx.updateOrder(order.id, businessId, {
          status: transitionOrder(checkout.status, "SUBMITTED"),
          submittedAt: now,
        }, checkout.version);
        if (!submitted) throw new Error("STALE_VERSION");
        await new ReservationService(tx).holdSubmittedOrderLocked(tx, businessId, order.id, idempotencyKey, now);
        const minted = await new OrderAccessService(tx).mint(
          businessId, order.id, "STATUS", new Date(now.getTime() + 30 * 24 * 60 * 60_000), now,
        );
        await tx.claimIdempotency({
          businessId, key: idempotencyKey, commandType: "order.public.submit", fingerprint, resultId: order.id,
        });
        recordOrderLifecycle("WEB", "SUBMITTED");
        return { order: submitted, statusToken: minted.token, replayed: false };
      }),
    );
  }

  async publicStatus(token: string) {
    const access = await new OrderAccessService(this.db).authenticate(token, "STATUS");
    const order = await this.db.findOrderById(access.orderId, access.businessId);
    if (!order) throw new Error("NOT_FOUND");
    const [lines, fulfillments, paymentStatus] = await Promise.all([
      this.db.listOrderLines(order.id, order.businessId),
      this.db.listFulfillmentsByOrder(order.id, order.businessId),
      this.paymentStatus(order),
    ]);
    return {
      id: order.id,
      status: order.status,
      paymentStatus,
      fulfillmentMode: order.fulfillmentMode,
      paymentMode: order.paymentMode,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      deliveryTaxMinor: order.deliveryTaxMinor,
      totalMinor: order.totalMinor,
      createdAt: order.createdAt,
      submittedAt: order.submittedAt,
      confirmedAt: order.confirmedAt,
      completedAt: order.completedAt,
      lines: lines.map((line) => ({
        id: line.id, name: line.name, unit: line.unit, qty: line.qty,
        priceMinor: line.priceMinor, discountMinor: line.discountMinor, taxMinor: line.taxMinor,
        lineTotalMinor: line.lineTotalMinor,
      })),
      fulfillments: fulfillments.map((row) => ({
        id: row.id, type: row.type, status: row.status, readyAt: row.readyAt,
        dispatchedAt: row.dispatchedAt, deliveredAt: row.deliveredAt, collectedAt: row.collectedAt,
      })),
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

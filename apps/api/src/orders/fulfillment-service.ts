import type {
  DbFulfillment,
  DbFulfillmentStatus,
  DbFulfillmentType,
  DbPort,
} from "../common/db.port";
import { fingerprintPayload } from "../sales/idempotency";
import { transitionFulfillment, transitionOrder } from "./order-state";
import type { OrderNotificationService } from "./order-notification-service";
import { recordFulfillmentOutcome, recordIdempotencyConflict, recordOrderLifecycle } from "../common/metrics";

type Allocation = { orderLineId: string; qty: number };

function fulfillmentIdempotencyMismatch(): never {
  recordIdempotencyConflict("fulfillment");
  throw new Error("IDEMPOTENCY_MISMATCH");
}

export class FulfillmentService {
  constructor(
    private readonly db: DbPort,
    private readonly notifications?: OrderNotificationService,
  ) {}

  /**
   * Ensures the operational fulfillment projected from a confirmed WEB order
   * exists. Callers must already hold the order's settlement lock/transaction.
   * This intentionally does not touch money, reservations, or inventory.
   */
  async ensureFulfillmentLocked(
    businessId: string,
    orderId: string,
  ): Promise<DbFulfillment> {
    const order = await this.db.findOrderById(orderId, businessId);
    if (!order || !order.branchId || order.fulfillmentMode === "NONE") {
      throw new Error("VALIDATION");
    }

    const existing = (await this.db.listFulfillmentsByOrder(order.id, businessId))[0];
    if (existing) return existing;

    const lines = await this.db.listOrderLines(order.id, businessId);
    if (lines.length === 0) throw new Error("VALIDATION");
    const now = new Date();
    const fulfillment = await this.db.createFulfillment({
      businessId,
      orderId: order.id,
      type: order.fulfillmentMode,
      status: "PENDING",
      branchId: order.branchId,
      assignedUserId: null,
      contactName: order.contactName,
      email: order.email,
      phone: order.phone,
      deliveryAddress: order.deliveryAddress,
      instructions: order.fulfillmentInstructions,
      version: 1,
      readyAt: null,
      dispatchedAt: null,
      deliveredAt: null,
      collectedAt: null,
      failedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    });
    for (const line of lines) {
      await this.db.createFulfillmentLine({
        businessId,
        fulfillmentId: fulfillment.id,
        orderLineId: line.id,
        qty: line.qty,
        createdAt: now,
      });
    }
    return fulfillment;
  }

  async createFulfillment(
    businessId: string,
    orderId: string,
    type: DbFulfillmentType,
    branchId: string,
    allocations: Allocation[],
  ): Promise<DbFulfillment> {
    if (allocations.length === 0 || allocations.some((row) => !Number.isInteger(row.qty) || row.qty <= 0)) {
      throw new Error("VALIDATION");
    }
    return this.db.withLock("fulfillment:" + businessId + ":" + orderId, () =>
      this.db.withTransaction(async (tx) => {
        const order = await tx.findOrderById(orderId, businessId);
        if (!order) throw new Error("NOT_FOUND");
        if (order.branchId !== branchId || (order.fulfillmentMode !== type && order.fulfillmentMode !== "NONE")) {
          throw new Error("VALIDATION");
        }
        const lines = await tx.listOrderLines(order.id, businessId);
        const lineById = new Map(lines.map((line) => [line.id, line]));
        const requested = new Map<string, number>();
        for (const allocation of allocations) {
          if (!lineById.has(allocation.orderLineId)) throw new Error("VALIDATION");
          requested.set(allocation.orderLineId, (requested.get(allocation.orderLineId) ?? 0) + allocation.qty);
        }
        const existing = await tx.listFulfillmentsByOrder(order.id, businessId);
        const alreadyAllocated = new Map<string, number>();
        for (const fulfillment of existing) {
          if (fulfillment.status === "CANCELLED") continue;
          for (const row of await tx.listFulfillmentLines(fulfillment.id, businessId)) {
            alreadyAllocated.set(row.orderLineId, (alreadyAllocated.get(row.orderLineId) ?? 0) + row.qty);
          }
        }
        for (const [lineId, qty] of requested) {
          const line = lineById.get(lineId)!;
          if ((alreadyAllocated.get(lineId) ?? 0) + qty > line.qty) throw new Error("FULFILLMENT_OVERALLOCATED");
        }
        const now = new Date();
        const fulfillment = await tx.createFulfillment({
          businessId,
          orderId,
          type,
          status: "PENDING",
          branchId,
          assignedUserId: null,
          contactName: order.contactName,
          email: order.email,
          phone: order.phone,
          deliveryAddress: order.deliveryAddress,
          instructions: order.fulfillmentInstructions,
          version: 1,
          readyAt: null,
          dispatchedAt: null,
          deliveredAt: null,
          collectedAt: null,
          failedAt: null,
          cancelledAt: null,
          createdAt: now,
          updatedAt: now,
        });
        for (const row of allocations) {
          await tx.createFulfillmentLine({
            businessId,
            fulfillmentId: fulfillment.id,
            orderLineId: row.orderLineId,
            qty: row.qty,
            createdAt: now,
          });
        }
        return fulfillment;
      }),
    );
  }

  async assignFulfillment(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    fulfillmentId: string,
    assignedUserId: string | null,
    expectedVersion: number,
    key: string,
  ): Promise<DbFulfillment> {
    const fingerprint = fingerprintPayload({ orderId, fulfillmentId, assignedUserId, expectedVersion });
    return this.db.withLock("fulfillment:" + businessId + ":" + fulfillmentId, () =>
      this.db.withTransaction(async (tx) => {
        const replay = await tx.findIdempotency(businessId, key, "fulfillment.assign");
        if (replay) {
          if (replay.fingerprint !== fingerprint) fulfillmentIdempotencyMismatch();
          const row = await tx.findFulfillmentById(fulfillmentId, businessId);
          if (!row) throw new Error("NOT_FOUND");
          return row;
        }
        const row = await tx.findFulfillmentById(fulfillmentId, businessId);
        if (!row || row.orderId !== orderId) throw new Error("NOT_FOUND");
        if (row.version !== expectedVersion) throw new Error("STALE_VERSION");
        if (assignedUserId !== null) {
          const membership = await tx.findMembership(assignedUserId, businessId);
          if (!membership || membership.deactivatedAt) throw new Error("VALIDATION");
        }
        const next = await tx.updateFulfillment(row.id, businessId, { assignedUserId }, expectedVersion);
        if (!next) throw new Error("STALE_VERSION");
        await tx.claimIdempotency({ businessId, key, commandType: "fulfillment.assign", fingerprint, resultId: row.id });
        await tx.appendAudit({
          businessId, actorId, action: "fulfillment.assign", entityType: "Fulfillment",
          entityId: row.id, requestId, after: { assignedUserId },
        });
        return next;
      }),
    );
  }

  private timestampPatch(target: DbFulfillmentStatus, now: Date): Partial<DbFulfillment> {
    if (target === "READY") return { readyAt: now };
    if (target === "DISPATCHED") return { dispatchedAt: now, failedAt: null };
    if (target === "DELIVERED") return { deliveredAt: now };
    if (target === "COLLECTED") return { collectedAt: now };
    if (target === "DELIVERY_FAILED") return { failedAt: now };
    if (target === "CANCELLED") return { cancelledAt: now };
    return {};
  }

  async transition(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    fulfillmentId: string,
    target: DbFulfillmentStatus,
    expectedVersion: number,
    key: string,
  ): Promise<DbFulfillment> {
    const commandType = "fulfillment." + target.toLowerCase();
    const fingerprint = fingerprintPayload({ orderId, fulfillmentId, target, expectedVersion });
    const result = await this.db.withLock("fulfillment:" + businessId + ":" + fulfillmentId, () =>
      this.db.withTransaction(async (tx) => {
        const replay = await tx.findIdempotency(businessId, key, commandType);
        if (replay) {
          if (replay.fingerprint !== fingerprint) fulfillmentIdempotencyMismatch();
          const row = await tx.findFulfillmentById(fulfillmentId, businessId);
          if (!row) throw new Error("NOT_FOUND");
          return { row, notify: false };
        }
        const order = await tx.findOrderById(orderId, businessId);
        const current = await tx.findFulfillmentById(fulfillmentId, businessId);
        if (!order || !current || current.orderId !== order.id) throw new Error("NOT_FOUND");
        if (current.version !== expectedVersion) throw new Error("STALE_VERSION");
        const status = transitionFulfillment(current.type, current.status, target);
        const now = new Date();
        const next = await tx.updateFulfillment(current.id, businessId, {
          status,
          ...this.timestampPatch(status, now),
        }, expectedVersion);
        if (!next) throw new Error("STALE_VERSION");
        await tx.claimIdempotency({ businessId, key, commandType, fingerprint, resultId: current.id });
        await tx.appendAudit({
          businessId, actorId, action: commandType, entityType: "Fulfillment",
          entityId: current.id, requestId, after: { status },
        });
        if (status === "COLLECTED" || status === "DELIVERED") {
          await this.completeOrderIfFullyHandedOffLocked(tx, businessId, order.id);
        }
        return { row: next, notify: ["READY", "DISPATCHED", "DELIVERY_FAILED"].includes(status) };
      }),
    );
    if (result.notify && this.notifications) {
      await this.notifications.sendEvent(businessId, orderId, result.row.status);
    }
    recordFulfillmentOutcome(
      result.row.type,
      result.row.status,
      Math.max(0, result.row.updatedAt.getTime() - result.row.createdAt.getTime()),
    );
    return result.row;
  }

  async cancelFulfillment(
    businessId: string,
    actorId: string,
    requestId: string,
    orderId: string,
    fulfillmentId: string,
    expectedVersion: number,
    key: string,
    returnedToMerchant: boolean,
  ): Promise<DbFulfillment> {
    const current = await this.db.findFulfillmentById(fulfillmentId, businessId);
    if (!current || current.orderId !== orderId) throw new Error("NOT_FOUND");
    if (current.status === "DISPATCHED") throw new Error("INVALID_STATE");
    if (current.status === "DELIVERY_FAILED" && !returnedToMerchant) throw new Error("VALIDATION");
    return this.transition(businessId, actorId, requestId, orderId, fulfillmentId, "CANCELLED", expectedVersion, key);
  }

  async completeOrderIfFullyHandedOff(orderId: string, businessId?: string): Promise<boolean> {
    if (!businessId) throw new Error("VALIDATION");
    return this.db.withTransaction((tx) => this.completeOrderIfFullyHandedOffLocked(tx, businessId, orderId));
  }

  private async completeOrderIfFullyHandedOffLocked(db: DbPort, businessId: string, orderId: string): Promise<boolean> {
    const order = await db.findOrderById(orderId, businessId);
    if (!order || order.status !== "CONFIRMED") return false;
    const lines = await db.listOrderLines(order.id, businessId);
    const successful = new Map<string, number>();
    for (const fulfillment of await db.listFulfillmentsByOrder(order.id, businessId)) {
      if (!["COLLECTED", "DELIVERED"].includes(fulfillment.status)) continue;
      for (const allocation of await db.listFulfillmentLines(fulfillment.id, businessId)) {
        successful.set(allocation.orderLineId, (successful.get(allocation.orderLineId) ?? 0) + allocation.qty);
      }
    }
    if (!lines.every((line) => (successful.get(line.id) ?? 0) >= line.qty)) return false;
    const next = await db.updateOrder(order.id, businessId, {
      status: transitionOrder(order.status, "COMPLETED"),
      completedAt: new Date(),
    }, order.version);
    if (next) recordOrderLifecycle(order.channel, "COMPLETED");
    return Boolean(next);
  }
}

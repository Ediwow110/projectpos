import type { DbInventoryReservation, DbOrderLine, DbPort } from "../common/db.port";
import { InventoryAvailabilityService } from "../inventory/availability-service";
import { withInventoryLocks } from "../inventory/inventory-locks";

interface ReservationNeed {
  orderLineId: string;
  productId: string;
  qty: number;
}

function bundleNeeds(line: DbOrderLine): Array<{ componentProductId: string; quantityPerBundleSnapshot: number }> | null {
  if (line.bundleComponentsSnapshot === null) return null;
  if (!Array.isArray(line.bundleComponentsSnapshot) || line.bundleComponentsSnapshot.length === 0) {
    throw new Error("INVALID_BUNDLE_SNAPSHOT");
  }
  return line.bundleComponentsSnapshot.map((value) => {
    const row = value as { componentProductId?: unknown; quantityPerBundleSnapshot?: unknown };
    if (
      typeof value !== "object" ||
      value === null ||
      typeof row.componentProductId !== "string" ||
      !Number.isInteger(row.quantityPerBundleSnapshot) ||
      Number(row.quantityPerBundleSnapshot) <= 0
    ) {
      throw new Error("INVALID_BUNDLE_SNAPSHOT");
    }
    return {
      componentProductId: row.componentProductId,
      quantityPerBundleSnapshot: Number(row.quantityPerBundleSnapshot),
    };
  });
}

function aggregateNeeds(needs: ReservationNeed[]): Array<{ productId: string; qty: number }> {
  const grouped = new Map<string, number>();
  for (const need of needs) grouped.set(need.productId, (grouped.get(need.productId) ?? 0) + need.qty);
  return [...grouped].map(([productId, qty]) => ({ productId, qty }));
}

export class ReservationService {
  constructor(private readonly db: DbPort) {}

  private async needs(db: DbPort, businessId: string, orderId: string): Promise<ReservationNeed[]> {
    const lines = await db.listOrderLines(orderId, businessId);
    const out: ReservationNeed[] = [];
    for (const line of lines) {
      const components = bundleNeeds(line);
      if (components) {
        for (const component of components) {
          out.push({
            orderLineId: line.id,
            productId: component.componentProductId,
            qty: line.qty * component.quantityPerBundleSnapshot,
          });
        }
        continue;
      }
      const product = await db.findProductById(line.productId, businessId);
      if (!product) throw new Error("NOT_FOUND");
      if (product.trackInventory) out.push({ orderLineId: line.id, productId: line.productId, qty: line.qty });
    }
    return out;
  }

  async holdSubmittedOrder(
    businessId: string,
    orderId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DbInventoryReservation[]> {
    return this.db.withLock("sales:" + businessId, () =>
      this.holdSubmittedOrderLocked(this.db, businessId, orderId, idempotencyKey, now),
    );
  }

  async holdSubmittedOrderLocked(
    db: DbPort,
    businessId: string,
    orderId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DbInventoryReservation[]> {
      const order = await db.findOrderById(orderId, businessId);
      if (!order) throw new Error("NOT_FOUND");
      if (order.status !== "SUBMITTED" || !order.branchId) throw new Error("INVALID_STATE");
      const branchId = order.branchId;
      const existing = await db.listReservationsByOrder(orderId, businessId);
      if (existing.length) {
        if (!existing.every((row) => row.idempotencyKey.startsWith(idempotencyKey + ":"))) {
          throw new Error("IDEMPOTENCY_MISMATCH");
        }
        return existing;
      }
      const needs = await this.needs(db, businessId, orderId);
      const targets = needs.map((need) => ({ productId: need.productId, branchId }));
      return withInventoryLocks(db, businessId, targets, async () =>
        db.withTransaction(async (tx) => {
          const replay = await tx.listReservationsByOrder(orderId, businessId);
          if (replay.length) return replay;
          await new InventoryAvailabilityService(tx).assertDecreaseAllowed(
            businessId,
            branchId,
            aggregateNeeds(needs),
          );
          const out: DbInventoryReservation[] = [];
          for (const need of needs) {
            out.push(await tx.createInventoryReservation({
              businessId,
              branchId,
              orderId,
              orderLineId: need.orderLineId,
              productId: need.productId,
              qty: need.qty,
              status: "HELD",
              expiresAt: new Date(now.getTime() + 20 * 60_000),
              idempotencyKey: idempotencyKey + ":" + need.orderLineId + ":" + need.productId,
              createdAt: now,
              updatedAt: now,
            }));
          }
          return out;
        }),
      );
  }

  async releaseOrder(
    businessId: string,
    orderId: string,
    target: "RELEASED" | "EXPIRED",
  ): Promise<DbInventoryReservation[]> {
    return this.db.withLock("sales:" + businessId, () =>
      this.releaseOrderLocked(this.db, businessId, orderId, target),
    );
  }

  async releaseOrderLocked(
    db: DbPort,
    businessId: string,
    orderId: string,
    target: "RELEASED" | "EXPIRED",
  ): Promise<DbInventoryReservation[]> {
    const rows = (await db.listReservationsByOrder(orderId, businessId)).filter((row) => row.status === "HELD");
    return withInventoryLocks(
      db,
      businessId,
      rows.map((row) => ({ productId: row.productId, branchId: row.branchId })),
      async () => db.withTransaction(async (tx) => {
        const current = (await tx.listReservationsByOrder(orderId, businessId)).filter((row) => row.status === "HELD");
        const out: DbInventoryReservation[] = [];
        for (const row of current) {
          const next = await tx.updateInventoryReservation(row.id, businessId, { status: target });
          if (next) out.push(next);
        }
        return out;
      }),
    );
  }

  async commitForSale(businessId: string, orderId: string, saleId: string): Promise<void> {
    return this.db.withLock("sales:" + businessId, () =>
      this.commitForSaleLocked(this.db, businessId, orderId, saleId),
    );
  }

  async commitForSaleLocked(db: DbPort, businessId: string, orderId: string, saleId: string): Promise<void> {
    const order = await db.findOrderById(orderId, businessId);
    if (!order || order.saleId !== saleId) throw new Error("CONFLICT");
    const needs = aggregateNeeds(await this.needs(db, businessId, orderId));
    const rows = (await db.listReservationsByOrder(orderId, businessId)).filter((row) => row.status === "HELD");
    const actual = new Map<string, number>();
    for (const row of rows) actual.set(row.productId, (actual.get(row.productId) ?? 0) + row.qty);
    if (
      needs.length !== actual.size ||
      needs.some((need) => actual.get(need.productId) !== need.qty)
    ) throw new Error("RESERVATION_CONFLICT");
    await withInventoryLocks(
      db,
      businessId,
      rows.map((row) => ({ productId: row.productId, branchId: row.branchId })),
      async () => db.withTransaction(async (tx) => {
        const latest = (await tx.listReservationsByOrder(orderId, businessId)).filter((row) => row.status === "HELD");
        if (latest.length !== rows.length) throw new Error("RESERVATION_CONFLICT");
        for (const row of latest) {
          const next = await tx.updateInventoryReservation(row.id, businessId, { status: "COMMITTED", expiresAt: null });
          if (!next) throw new Error("RESERVATION_CONFLICT");
        }
      }),
    );
  }
}

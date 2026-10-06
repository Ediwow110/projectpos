import type { DbOrder, DbPort } from "../common/db.port";
import type { PayMongoPort } from "../payments/paymongo";
import { withInventoryLocks } from "../inventory/inventory-locks";
import { ReservationService } from "./reservation-service";
import { OrderAccessService } from "./order-access-service";
import { incrementMetric, recordOrderLifecycle, setMetric } from "../common/metrics";

export class OrderExpiryService {
  constructor(private readonly db: DbPort, private readonly paymongo: PayMongoPort) {}

  private async preserveProviderHold(tx: DbPort, order: DbOrder, now: Date): Promise<boolean> {
    if (!order.saleId) return false;
    const payments = await tx.listPaymentsBySale(order.saleId, order.businessId);
    const pending = [...payments].reverse().find((row) => row.providerRef && ["PENDING", "UNKNOWN", "SUCCEEDED"].includes(row.status));
    if (!pending?.providerRef) return false;
    let snapshot;
    try {
      snapshot = await this.paymongo.retrieveCheckout(pending.providerRef);
    } catch {
      snapshot = { status: "unknown" as const, paid: false };
    }
    if (snapshot.status === "expired" && !snapshot.paid) return false;
    const rows = (await tx.listReservationsByOrder(order.id, order.businessId)).filter((row) => row.status === "HELD");
    await withInventoryLocks(
      tx,
      order.businessId,
      rows.map((row) => ({ productId: row.productId, branchId: row.branchId })),
      async () => {
        const expiresAt = new Date(now.getTime() + 5 * 60_000);
        for (const row of rows) {
          await tx.updateInventoryReservation(row.id, order.businessId, { expiresAt });
        }
      },
    );
    return true;
  }

  private async expireOne(candidate: DbOrder, now: Date): Promise<boolean> {
    return this.db.withLock("sales:" + candidate.businessId, () =>
      this.db.withTransaction(async (tx) => {
        const order = await tx.findOrderById(candidate.id, candidate.businessId);
        if (!order || order.status !== "SUBMITTED") return false;
        const due = (await tx.listReservationsByOrder(order.id, order.businessId))
          .filter((row) => row.status === "HELD" && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime());
        if (due.length === 0) return false;
        if (order.paymentMode === "PREPAID" && await this.preserveProviderHold(tx, order, now)) return false;
        await new ReservationService(tx).releaseOrderLocked(tx, order.businessId, order.id, "EXPIRED");
        const next = await tx.updateOrder(order.id, order.businessId, { status: "EXPIRED" }, order.version);
        if (!next) return false;
        await new OrderAccessService(tx).revokeCheckoutTokens(order.businessId, order.id, now);
        await tx.appendAudit({
          businessId: order.businessId,
          actorId: "system",
          action: "order.expired",
          entityType: "Order",
          entityId: order.id,
          requestId: "order-expiry",
        });
        recordOrderLifecycle(order.channel, "EXPIRED");
        return true;
      }),
    );
  }

  async sweep(now: Date = new Date()): Promise<number> {
    const aged = await this.db.listAgedOperationalReservations(new Date(now.getTime() - 24 * 60 * 60_000), 1000);
    setMetric("pos_order_aged_operational_holds", aged.length);
    const due = await this.db.listDueReservationOrders(now, 100);
    let count = 0;
    for (const order of due) if (await this.expireOne(order, now)) count += 1;
    return count;
  }

  start(): NodeJS.Timeout {
    const run = (): void => {
      void this.sweep().catch(() => {
        incrementMetric("pos_order_expiry_worker_failures_total");
      });
    };
    run();
    const timer = setInterval(run, 60_000);
    timer.unref();
    return timer;
  }
}

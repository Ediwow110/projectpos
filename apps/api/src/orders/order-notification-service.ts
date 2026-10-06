import type { DbPort } from "../common/db.port";
import { incrementMetric } from "../common/metrics";
import type { TransactionalEmailPort } from "../email/email.service";
import { OrderAccessService } from "./order-access-service";

export class OrderNotificationService {
  private readonly access: OrderAccessService;
  constructor(private readonly db: DbPort, private readonly email: TransactionalEmailPort) {
    this.access = new OrderAccessService(db);
  }

  async sendExistingToken(
    businessId: string,
    orderId: string,
    event: string,
    token: string,
  ): Promise<boolean> {
    const order = await this.db.findOrderById(orderId, businessId);
    if (!order?.email) return false;
    try {
      await this.email.sendOrderUpdate({
        to: order.email,
        contactName: order.contactName,
        orderId: order.id,
        event,
        token,
      });
      await this.db.appendAudit({
        businessId,
        actorId: "system",
        action: "order.notification.sent",
        entityType: "Order",
        entityId: order.id,
        requestId: "order-notification",
        after: { event },
      });
      return true;
    } catch {
      incrementMetric("pos_order_notification_failures_total");
      await this.db.appendAudit({
        businessId,
        actorId: "system",
        action: "order.notification.failed",
        entityType: "Order",
        entityId: order.id,
        requestId: "order-notification",
        after: { event },
      });
      return false;
    }
  }

  async sendEvent(businessId: string, orderId: string, event: string): Promise<boolean> {
    const order = await this.db.findOrderById(orderId, businessId);
    if (!order?.email) return false;
    const minted = await this.access.mint(
      businessId,
      orderId,
      "STATUS",
      new Date(Date.now() + 30 * 24 * 60 * 60_000),
    );
    return this.sendExistingToken(businessId, orderId, event, minted.token);
  }

  async resend(businessId: string, orderId: string): Promise<boolean> {
    const now = new Date();
    await this.access.revokeAll(businessId, orderId, "STATUS", now);
    const minted = await this.access.mint(
      businessId,
      orderId,
      "STATUS",
      new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      now,
    );
    return this.sendExistingToken(businessId, orderId, "STATUS_LINK", minted.token);
  }

  async revoke(businessId: string, orderId: string): Promise<number> {
    return this.access.revokeAll(businessId, orderId, "STATUS");
  }
}

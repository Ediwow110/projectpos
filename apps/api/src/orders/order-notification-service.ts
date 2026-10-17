import type { DbPort } from "../common/db.port";
import { incrementMetric } from "../common/metrics";
import type { TransactionalEmailPort } from "../email/email.service";
import { OrderAccessService } from "./order-access-service";
import type { OrderNotificationOutboxStore } from "./order-notification-outbox";

export class OrderNotificationService {
  private readonly access: OrderAccessService;
  constructor(private readonly db: DbPort, private readonly email: TransactionalEmailPort,
    private readonly outbox: OrderNotificationOutboxStore | null = null) {
    this.access = new OrderAccessService(db);
  }

  hasOutbox(): boolean {
    return this.outbox !== null;
  }

  // Must be called INSIDE the same DbPort transaction as the state transition.
  // The PostgreSQL outbox shares PgContext's transaction-local client.
  async enqueueEvent(businessId: string, orderId: string, event: string, dedupeKey: string): Promise<void> {
    if (!this.outbox) throw new Error("OUTBOX_DISABLED");
    await this.outbox.enqueue({ businessId, orderId, event, dedupeKey });
  }

  async sendExistingToken(
    businessId: string,
    orderId: string,
    event: string,
    token: string,
  ): Promise<boolean> {
    const order = await this.db.findOrderById(orderId, businessId);
    if (!order?.email) return false;
    let accepted = false;
    try {
      await this.email.sendOrderUpdate({
        to: order.email,
        contactName: order.contactName,
        orderId: order.id,
        event,
        token,
      });
      accepted = true;
    } catch {
      incrementMetric("pos_order_notification_failures_total");
    }
    try {
      await this.db.appendAudit({
        businessId,
        actorId: "system",
        action: accepted ? "order.notification.sent" : "order.notification.failed",
        entityType: "Order",
        entityId: order.id,
        requestId: "order-notification",
        after: { event },
      });
    } catch {
      // An audit write failing must not change the truth of an already
      // accepted email. Report it as a separate, non-PII operational signal.
      incrementMetric("pos_order_notification_audit_failures_total");
    }
    return accepted;
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
    // Do not destroy customers' existing working status links until the
    // replacement has actually been accepted by the email transport.
    const prior = await this.db.listActiveOrderAccessTokens(orderId, businessId, "STATUS", now);
    const minted = await this.access.mint(
      businessId,
      orderId,
      "STATUS",
      new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      now,
    );
    const sent = await this.sendExistingToken(businessId, orderId, "STATUS_LINK", minted.token);
    if (!sent) {
      // The replacement was never delivered. Retire only its own token.
      // Previously issued links remain available for customer recovery.
      await this.db.revokeOrderAccessToken(minted.row.id, businessId, new Date());
      return false;
    }
    for (const token of prior) {
      await this.db.revokeOrderAccessToken(token.id, businessId, new Date());
    }
    return true;
  }

  async revoke(businessId: string, orderId: string): Promise<number> {
    if (this.outbox) await this.outbox.cancelOrder(businessId, orderId, new Date());
    return this.access.revokeAll(businessId, orderId, "STATUS");
  }
}

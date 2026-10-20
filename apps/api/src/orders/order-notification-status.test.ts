import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../common/db.port";
import { orderNotificationStatusFromAudit } from "./order-notification-status";

const entry = (action: string, after: Record<string, unknown>, at: Date): AuditEntry => ({
  businessId: "biz", actorId: "system", action, entityType: "Order",
  entityId: "ord", requestId: "qa", after, at,
});

describe("audited order notification delivery evidence", () => {
  it("distinguishes absence, failure, provider acceptance and a failed operator resend", () => {
    const t1 = new Date("2026-10-18T01:00:00Z");
    const t2 = new Date("2026-10-18T02:00:00Z");
    expect(orderNotificationStatusFromAudit([])).toEqual({
      state: "NOT_ATTEMPTED", event: null, lastAttemptAt: null,
    });
    const failed = entry("order.notification.failed", { event: "CONFIRMED" }, t1);
    expect(orderNotificationStatusFromAudit([failed])).toEqual({
      state: "FAILED", event: "CONFIRMED", lastAttemptAt: t1.toISOString(),
    });
    const resend = entry("order.access.resend", { sent: false }, t2);
    expect(orderNotificationStatusFromAudit([failed, resend])).toEqual({
      state: "NOT_SENT", event: "STATUS_LINK", lastAttemptAt: t2.toISOString(),
    });
    const sent = entry("order.notification.sent", { event: "STATUS_LINK" }, t2);
    expect(orderNotificationStatusFromAudit([failed, sent])).toEqual({
      state: "ACCEPTED", event: "STATUS_LINK", lastAttemptAt: t2.toISOString(),
    });
    expect(orderNotificationStatusFromAudit([sent, entry("order.access.resend", { sent: true }, t2)]).state)
      .toBe("ACCEPTED");
  });

  it("does not expose arbitrary PII or token strings stored in unrelated audit snapshots", () => {
    const t1 = new Date("2026-10-18T01:00:00Z");
    const status = orderNotificationStatusFromAudit([
      entry("order.notification.failed", { event: "customer@example.com secret-token-123" }, t1),
      entry("order.link_customer", { event: "CANCELLED", token: "secret" }, t1),
    ]);
    expect(status).toMatchObject({ state: "FAILED", event: null });
    expect(JSON.stringify(status)).not.toContain("customer@example.com");
    expect(JSON.stringify(status)).not.toContain("secret");
  });
});

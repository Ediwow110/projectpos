import type { AuditEntry } from "../common/db.port";

/**
 * Operational evidence from already persisted audit records. A successful
 * send means Brevo accepted the request, NOT that an inbox received the email.
 * No addresses, tokens, or provider payloads are surfaced to staff.
 */
export type OrderNotificationStatus =
  | { state: "NOT_ATTEMPTED"; event: null; lastAttemptAt: null }
  | { state: "ACCEPTED" | "FAILED" | "NOT_SENT"; event: string | null; lastAttemptAt: string | null };

export function orderNotificationStatusFromAudit(entries: AuditEntry[]): OrderNotificationStatus {
  const relevant = entries.filter((item) =>
    item.action === "order.notification.sent"
    || item.action === "order.notification.failed"
    || item.action === "order.access.resend");
  const last = relevant.at(-1);
  if (!last) return { state: "NOT_ATTEMPTED", event: null, lastAttemptAt: null };

  const rawEvent = last.after && typeof last.after === "object"
    ? (last.after as Record<string, unknown>)["event"] : null;
  // Explicit allowlist: do not echo arbitrary text or customer data stored in
  // audit snapshots. The UI only needs a recognized workflow event.
  const event = typeof rawEvent === "string" && [
    "CONFIRMED", "STATUS_LINK", "READY", "PACKED", "DISPATCHED",
    "DELIVERED", "COLLECTED", "DELIVERY_FAILED", "CANCELLED", "REJECTED",
  ].includes(rawEvent) ? rawEvent : null;
  const at = last.at instanceof Date && Number.isFinite(last.at.getTime())
    ? last.at.toISOString() : null;
  if (last.action === "order.access.resend") {
    const after = last.after && typeof last.after === "object"
      ? last.after as Record<string, unknown> : {};
    return {
      state: after["sent"] === true ? "ACCEPTED" : "NOT_SENT",
      event: "STATUS_LINK",
      lastAttemptAt: at,
    };
  }
  return { state: last.action === "order.notification.sent" ? "ACCEPTED" : "FAILED", event, lastAttemptAt: at };
}

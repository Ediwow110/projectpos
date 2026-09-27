import { createHmac, timingSafeEqual } from "node:crypto";
import { withScope } from "@pos/database";

import type { DbInvoice, DbPort, DbWebhookEvent } from "../common/db.port";
import { normalizeSubscriptionStatus } from "./entitlements";

const SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "canceled", "paused"]);
const WEBHOOK_CLAIM_TTL_MS = 5 * 60 * 1000;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function canonicalWebhookBody(body: unknown): string {
  return JSON.stringify(sortKeys(body));
}

export function isBillingSubscriptionStatus(status: string): boolean {
  return SUBSCRIPTION_STATUSES.has(status);
}

function webhookSecret(provider: string): string {
  const envKey = `BILLING_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_SECRET`;
  return process.env[envKey] ?? "";
}

interface BillingWebhookPayload {
  businessId?: string;
  invoiceId?: string;
  amountMinor?: number;
  planKey?: string;
  status?: string;
  reason?: string;
  providerRef?: string;
}

export class BillingWebhookService {
  constructor(
    private readonly db: DbPort,
    private readonly changePlan: (
      businessId: string,
      actorId: string,
      requestId: string,
      planKey: string,
      status?: string,
    ) => Promise<unknown>,
  ) {}

  async ingest(
    provider: string,
    eventId: string,
    type: string,
    payload: unknown,
    signature: string | undefined,
    requestId: string,
    rawBody?: string,
  ): Promise<{ ok: true; handled: boolean; deduplicated: boolean }> {
    const secret = webhookSecret(provider);
    if (secret.length === 0) throw new Error("FORBIDDEN");
    const body = { eventId, type, ...(payload as Record<string, unknown>) };
    const signedBytes = rawBody ?? canonicalWebhookBody(body);
    const expected = createHmac("sha256", secret).update(signedBytes).digest("hex");
    const presented = Buffer.from(signature ?? "");
    const expectedBuffer = Buffer.from(expected);
    if (presented.length !== expectedBuffer.length || !timingSafeEqual(presented, expectedBuffer)) {
      throw new Error("FORBIDDEN");
    }

    const seen = await this.db.findWebhookEvent(provider, eventId);
    if (seen) {
      if (seen.status === "processing" && seen.receivedAt.getTime() + WEBHOOK_CLAIM_TTL_MS > Date.now()) {
        throw new Error("WEBHOOK_IN_PROGRESS");
      }
      if (seen.status === "processing") await this.db.deleteWebhookEvent(seen.id);
      else return { ok: true, handled: seen.status === "applied", deduplicated: true };
    }

    const businessIdFromPayload =
      typeof (payload as { businessId?: unknown }).businessId === "string"
        ? (payload as { businessId: string }).businessId
        : null;
    const claim = await this.db.claimWebhookEvent({
      businessId: businessIdFromPayload,
      provider,
      eventId,
      type,
      payload: body as DbWebhookEvent["payload"],
      status: "processing",
    });
    if (!claim) {
      const stored = await this.db.findWebhookEvent(provider, eventId);
      if (stored?.status === "processing") throw new Error("WEBHOOK_IN_PROGRESS");
      return { ok: true, handled: stored?.status === "applied", deduplicated: true };
    }

    const parsed = payload as BillingWebhookPayload;
    const businessId = typeof parsed.businessId === "string" ? parsed.businessId : null;
    if (businessId) withScope(businessId, {});
    if (businessId) {
      const subscription = await this.db.getSubscription(businessId);
      if (subscription?.providerRef) {
        const providerRef = typeof parsed.providerRef === "string" ? parsed.providerRef : null;
        if (providerRef !== subscription.providerRef) throw new Error("FORBIDDEN");
      }
    }

    try {
      if (type === "invoice.paid" || type === "invoice.void") {
        if (!businessId) throw new Error("VALIDATION");
        const invoice = await this.resolveInvoice(businessId, parsed);
        if (type === "invoice.paid") {
          if (invoice.status !== "open") throw new Error("VALIDATION");
          await this.db.updateInvoice(invoice.id, businessId, { status: "paid", paidAt: new Date() });
        } else {
          if (invoice.status === "void") throw new Error("VALIDATION");
          await this.db.updateInvoice(invoice.id, businessId, { status: "void" });
        }
        await this.db.updateWebhookEventStatus(claim.id, "applied");
        await this.db.appendAudit({
          businessId,
          actorId: "webhook",
          action: type === "invoice.paid" ? "webhook.invoice" : "invoice.void",
          entityType: "Invoice",
          entityId: invoice.id,
          requestId,
        });
        return { ok: true, handled: true, deduplicated: false };
      }

      if (type === "subscription.created" || type === "subscription.updated") {
        if (!businessId || typeof parsed.planKey !== "string") throw new Error("VALIDATION");
        const status = normalizeSubscriptionStatus(parsed.status ?? "active");
        if (!isBillingSubscriptionStatus(status)) throw new Error("VALIDATION");
        await this.changePlan(businessId, "webhook", requestId, parsed.planKey, status);
        await this.db.appendAudit({
          businessId,
          actorId: "webhook",
          action: status === "trialing" ? "subscription.created" : "subscription.updated",
          entityType: "Subscription",
          entityId: `${parsed.planKey}:${status}`,
          requestId,
        });
        await this.db.updateWebhookEventStatus(claim.id, "applied");
        return { ok: true, handled: true, deduplicated: false };
      }

      await this.db.updateWebhookEventStatus(claim.id, "unhandled");
      return { ok: true, handled: false, deduplicated: false };
    } catch (error) {
      await this.db.deleteWebhookEvent(claim.id);
      throw error;
    }
  }

  private async resolveInvoice(
    businessId: string,
    payload: { invoiceId?: string; amountMinor?: number },
  ): Promise<DbInvoice> {
    const invoices = await this.db.listInvoices(businessId);
    if (typeof payload.invoiceId === "string") {
      const invoice = invoices.find((row) => row.id === payload.invoiceId);
      if (!invoice) throw new Error("NOT_FOUND");
      if (typeof payload.amountMinor === "number" && invoice.amountMinor !== payload.amountMinor) {
        throw new Error("VALIDATION");
      }
      return invoice;
    }
    if (typeof payload.amountMinor !== "number") throw new Error("VALIDATION");
    const matches = invoices.filter(
      (invoice) => invoice.amountMinor === payload.amountMinor && invoice.status === "open",
    );
    if (matches.length !== 1) throw matches.length === 0 ? new Error("NOT_FOUND") : new Error("VALIDATION");
    return matches[0]!;
  }
}

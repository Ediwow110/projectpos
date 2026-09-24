import { Inject, Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withScope } from "@pos/database";
import type { DbInvoice, DbPort, DbWebhookEvent } from "../../common/db.port";
import { PlanLimitError } from "../../common/plan-limit-error";
import { ENTERPRISE, isTrialExpired, monthPeriod, normalizeSubscriptionStatus, PLAN_ALLOWANCES, type PlanAllowances } from "../entitlements";

export type CapKind = "users" | "products" | "registers" | "branches";

const MAX_CATCHUP_PERIODS = 120;

const SUBSCRIPTION_STATUSES = new Set([
  "trialing", "active", "past_due", "cancelled", "paused",
]);

export interface ResolvedPlan {
  key: string;
  allowances: PlanAllowances;
  monthlyMinor: number;
}

export interface UsageSlice {
  used: number;
  limit: number | null;
}

export function canonicalWebhookBody(body: unknown): string {
  return JSON.stringify(sortKeys(body));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function webhookSecret(provider: string): string {
  const envKey = `BILLING_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_SECRET`;
  return process.env[envKey] ?? "";
}

// Process-wide per-business serialization. Cap checks and invoice rollover are
// read-then-write sequences, so without this two concurrent requests could both
// pass the same check (overselling a plan cap) or both invoice the same period.
// Lives at module scope because every domain service builds its own
// BillingService around the shared DbPort. A multi-process deployment needs the
// same guarantee from the database (SELECT ... FOR UPDATE / unique period),
// which arrives with the Prisma-backed port.
const businessLocks = new Map<string, Promise<void>>();

async function withBusinessLock<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  const previous = businessLocks.get(businessId) ?? Promise.resolve();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => held);
  businessLocks.set(businessId, chain);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (businessLocks.get(businessId) === chain) businessLocks.delete(businessId);
  }
}

@Injectable()
export class BillingService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  // Only an active subscription (or an unexpired trial) grants its plan.
  // Canceled, paused, and unknown statuses fall back to Free and are persisted
  // as such, so every other reader (dashboards, exports, integrations) sees the
  // same plan this method enforces. past_due keeps the plan: a failed payment is
  // a grace period, not a silent downgrade.
  async resolvePlan(businessId: string, now: Date = new Date()): Promise<ResolvedPlan> {
    withScope(businessId, {});
    const sub = await this.db.getSubscription(businessId);
    if (!sub) return { key: "enterprise", allowances: ENTERPRISE, monthlyMinor: 0 };
    if (isTrialExpired(sub.status, sub.trialEndsAt, now)) {
      return this.downgradeToFree(businessId, sub, "canceled", "subscription.expired", `expiry-${sub.id}`);
    }
    const status = normalizeSubscriptionStatus(sub.status);
    if (status === "canceled" || status === "paused" || status === "free") {
      return this.downgradeToFree(businessId, sub, "canceled", "subscription.canceled", `status-${sub.id}`);
    }
    return this.allowancesOf(sub.planId);
  }

  private async downgradeToFree(
    businessId: string,
    sub: { id: string; status: string; planId: string },
    status: string,
    action: string,
    requestId: string,
  ): Promise<ResolvedPlan> {
    const free = await this.db.findPlanByKey("free");
    if (!free) throw new Error("VALIDATION");
    if (sub.status !== status || sub.planId !== free.id) {
      await this.db.updateSubscription(sub.id, businessId, { planId: free.id, status, trialEndsAt: null });
      await this.db.appendAudit({
        businessId,
        actorId: "system",
        action,
        entityType: "Subscription",
        entityId: sub.id,
        requestId,
      });
    }
    return { key: free.key, allowances: free.allowances, monthlyMinor: free.pricesMinor.monthlyMinor };
  }

  private async allowancesOf(planId: string): Promise<ResolvedPlan> {
    const plans = await this.db.listPlans();
    const found = plans.find((p) => p.id === planId) ?? null;
    if (!found) return { key: "enterprise", allowances: ENTERPRISE, monthlyMinor: 0 };
    return { key: found.key, allowances: found.allowances, monthlyMinor: found.pricesMinor.monthlyMinor };
  }

  private async liveCount(businessId: string, kind: CapKind): Promise<number> {
    if (kind === "users") return (await this.db.listMembershipsByBusiness(businessId)).length;
    if (kind === "products") return (await this.db.listProducts(businessId)).length;
    if (kind === "registers") return (await this.db.listRegisters(businessId)).length;
    return (await this.db.listBranchesByBusiness(businessId)).length;
  }

  // Note: the "users" kind is metered and unit-tested here, but has no live
  // caller yet — memberships are only created at registration (which must
  // always succeed). A future TenantService member-add endpoint must call
  // requireCreate(..., "users") before creating the membership.
  async requireCreate(businessId: string, actorId: string, requestId: string, kind: CapKind): Promise<void> {
    withScope(businessId, {});
    const plan = await this.resolvePlan(businessId);
    const limit = plan.allowances[kind];
    const used = await this.liveCount(businessId, kind);
    await this.db.setCounter(businessId, `cap.${kind}`, "all-time", used);
    if (limit !== null && used >= limit) {
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "plan.limit",
        entityType: "Business",
        entityId: `${kind}:${used}/${limit}`,
        requestId,
      });
      throw new PlanLimitError({ limit, used, plan: plan.key, resource: kind });
    }
  }

  // The cap check and the write it guards must not interleave with another
  // request for the same business, otherwise the limit is advisory. Callers
  // pass the actual write so the check, the insert, and the counter snapshot
  // happen inside one critical section.
  async withCap<T>(
    businessId: string,
    actorId: string,
    requestId: string,
    kind: CapKind,
    write: () => Promise<T>,
  ): Promise<T> {
    return withBusinessLock(businessId, async () => {
      await this.requireCreate(businessId, actorId, requestId, kind);
      const out = await write();
      await this.db.setCounter(businessId, `cap.${kind}`, "all-time", await this.liveCount(businessId, kind));
      return out;
    });
  }

  async checkFeature(businessId: string, feature: string): Promise<boolean> {
    withScope(businessId, {});
    const override = await this.db.getFlag(businessId, feature);
    if (override) return override.enabled;
    const global = await this.db.getFlag(null, feature);
    if (global) return global.enabled;
    const plan = await this.resolvePlan(businessId);
    return plan.allowances.features.includes(feature);
  }

  async requireFeature(businessId: string, feature: string): Promise<void> {
    if (await this.checkFeature(businessId, feature)) return;
    const plan = await this.resolvePlan(businessId);
    throw new PlanLimitError({ feature, plan: plan.key });
  }

  async recordUsage(businessId: string, key: string, period: string): Promise<void> {
    withScope(businessId, {});
    const existing = (await this.db.listCounters(businessId)).find(
      (c) => c.key === key && c.period === period,
    );
    await this.db.setCounter(businessId, key, period, (existing?.count ?? 0) + 1);
  }

  async recordSale(businessId: string, now: Date = new Date()): Promise<void> {
    await this.recordUsage(businessId, "sales.monthly", monthPeriod(now));
  }

  async changePlan(
    businessId: string,
    actorId: string,
    requestId: string,
    planKey: string,
    status = "active",
  ): Promise<{ key: string }> {
    withScope(businessId, {});
    const business = await this.db.findBusinessById(businessId);
    if (!business) throw new Error("NOT_FOUND");
    const allowances = PLAN_ALLOWANCES[planKey];
    if (!allowances) throw new Error("VALIDATION");
    if (!SUBSCRIPTION_STATUSES.has(status)) throw new Error("VALIDATION");
    const plan = await this.db.findPlanByKey(planKey);
    if (!plan || !plan.isActive) throw new Error("VALIDATION");
    const existing = await this.db.getSubscription(businessId);
    const periodEnd = new Date(Date.now() + 30 * 86400000);
    const trialEndsAt = status === "trialing" ? new Date(Date.now() + 14 * 86400000) : null;
    if (existing) {
      await this.db.updateSubscription(existing.id, businessId, {
        planId: plan.id, status, trialEndsAt, currentPeriodEnd: periodEnd,
      });
    } else {
      await this.db.upsertSubscription({
        businessId, planId: plan.id, status, trialEndsAt, currentPeriodEnd: periodEnd,
      });
    }
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "plan.change",
      entityType: "Subscription",
      entityId: `${planKey}`,
      requestId,
    });
    return { key: planKey };
  }

  async rebuildCounters(businessId: string): Promise<{ checked: number; drifts: Array<{ key: string; snapshot: number; live: number }> }> {    withScope(businessId, {});
    const kinds: CapKind[] = ["users", "products", "registers", "branches"];
    const snapshots = await this.db.listCounters(businessId);
    const drifts: Array<{ key: string; snapshot: number; live: number }> = [];
    for (const kind of kinds) {
      const live = await this.liveCount(businessId, kind);
      const snap = snapshots.find((c) => c.key === `cap.${kind}` && c.period === "all-time");
      await this.db.setCounter(businessId, `cap.${kind}`, "all-time", live);
      if (snap && snap.count !== live) drifts.push({ key: `cap.${kind}`, snapshot: snap.count, live });
    }
    const period = monthPeriod(new Date());
    const sales = await this.monthlySaleCount(businessId);
    const salesSnap = snapshots.find((c) => c.key === "sales.monthly" && c.period === period);
    await this.db.setCounter(businessId, "sales.monthly", period, sales);
    if (salesSnap && salesSnap.count !== sales) {
      drifts.push({ key: `sales.monthly:${period}`, snapshot: salesSnap.count, live: sales });
    }
    return { checked: kinds.length + 1, drifts };
  }

  private async monthlySaleCount(businessId: string, now: Date = new Date()): Promise<number> {
    const [year, month] = monthPeriod(now).split("-").map((n) => Number(n));
    return (await this.db.listSalesByBusiness(businessId)).filter((s) => {
      if (s.status === "DRAFT" || s.status === "VOIDED") return false;
      const at = new Date(s.createdAt);
      return at.getUTCFullYear() === year && at.getUTCMonth() + 1 === month;
    }).length;
  }

  async listInvoices(businessId: string) {
    withScope(businessId, {});
    return this.db.listInvoices(businessId);
  }

  async usageSummary(businessId: string): Promise<{
    users: UsageSlice; products: UsageSlice; registers: UsageSlice; branches: UsageSlice; salesMonthly: number;
  }> {
    const plan = await this.resolvePlan(businessId);
    const [users, products, registers, branches] = await Promise.all([
      this.liveCount(businessId, "users"),
      this.liveCount(businessId, "products"),
      this.liveCount(businessId, "registers"),
      this.liveCount(businessId, "branches"),
    ]);
    const sales = await this.monthlySaleCount(businessId);
    return {
      users: { used: users, limit: plan.allowances.users },
      products: { used: products, limit: plan.allowances.products },
      registers: { used: registers, limit: plan.allowances.registers },
      branches: { used: branches, limit: plan.allowances.branches },
      salesMonthly: sales,
    };
  }

  async getSubscription(businessId: string): Promise<{
    planKey: string; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null;
    usage: { users: UsageSlice; products: UsageSlice; registers: UsageSlice; branches: UsageSlice; salesMonthly: number };
  }> {
    withScope(businessId, {});
    await this.rolloverIfDue(businessId);
    const plan = await this.resolvePlan(businessId);
    const sub = await this.db.getSubscription(businessId);
    return {
      planKey: plan.key,
      status: sub?.status ?? "active",
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      usage: await this.usageSummary(businessId),
    };
  }

  // Lazy time resolution (no cron per the design): every subscription read
  // catches up any period that has already ended. The lock makes concurrent
  // readers issue each period once, and the loop covers subscriptions that are
  // several periods behind instead of advancing a single month per request.
  async rolloverIfDue(businessId: string, now: Date = new Date()): Promise<void> {
    withScope(businessId, {});
    await withBusinessLock(businessId, async () => {
      const sub = await this.db.getSubscription(businessId);
      if (!sub || sub.status !== "active") return;
      const plan = await this.allowancesOf(sub.planId);
      let periodEnd = sub.currentPeriodEnd;
      for (let billed = 0; billed < MAX_CATCHUP_PERIODS; billed++) {
        if (periodEnd.getTime() > now.getTime()) break;
        const periodStart = new Date(periodEnd.getTime() - 30 * 86400000);
        const invoice = await this.db.createInvoice({
          businessId,
          subscriptionId: sub.id,
          periodStart,
          periodEnd,
          amountMinor: plan.monthlyMinor,
          currency: "PHP",
          status: "open",
          paidAt: null,
        });
        periodEnd = new Date(periodEnd.getTime() + 30 * 86400000);
        await this.db.updateSubscription(sub.id, businessId, { currentPeriodEnd: periodEnd });
        await this.db.appendAudit({
          businessId,
          actorId: "system",
          action: "invoice.issued",
          entityType: "Invoice",
          entityId: invoice.id,
          requestId: `rollover-${sub.id}`,
        });
      }
    });
  }

  async issueInvoice(
    businessId: string,
    actorId: string,
    requestId: string,
    input: { periodStart: Date; periodEnd: Date },
  ): Promise<{ id: string; amountMinor: number; status: string }> {
    withScope(businessId, {});
    const sub = await this.db.getSubscription(businessId);
    if (!sub) throw new Error("NOT_FOUND");
    const plan = await this.allowancesOf(sub.planId);
    const row = await this.db.createInvoice({
      businessId,
      subscriptionId: sub.id,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      amountMinor: plan.monthlyMinor,
      currency: "PHP",
      status: "open",
      paidAt: null,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "invoice.issued",
      entityType: "Invoice",
      entityId: row.id,
      requestId,
    });
    return { id: row.id, amountMinor: row.amountMinor, status: row.status };
  }

  // Signature first (constant-time), then claim the event id before touching
  // any billing state: the claim is what makes concurrent redeliveries of the
  // same event apply exactly once, instead of both mutating and one of them
  // losing the race on the insert.
  async ingestWebhook(
    provider: string,
    eventId: string,
    type: string,
    payload: unknown,
    signature: string | undefined,
    requestId: string,
  ): Promise<{ ok: true; handled: boolean; deduplicated: boolean }> {
    const secret = webhookSecret(provider);
    if (secret.length === 0) throw new Error("FORBIDDEN");
    const body = { eventId, type, ...(payload as Record<string, unknown>) };
    const expected = createHmac("sha256", secret).update(canonicalWebhookBody(body)).digest("hex");
    const a = Buffer.from(signature ?? "");
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("FORBIDDEN");
    const seen = await this.db.findWebhookEvent(provider, eventId);
    if (seen) return { ok: true as const, handled: seen.status === "applied", deduplicated: true };
    // Claim before any mutation. A concurrent redelivery of the same eventId
    // loses the claim and is reported as a deduplicated replay, so exactly one
    // delivery applies the state change.
    const claim = await this.db.claimWebhookEvent({
      businessId: typeof (payload as { businessId?: unknown }).businessId === "string"
        ? ((payload as { businessId: string }).businessId)
        : null,
      provider,
      eventId,
      type,
      payload: body as DbWebhookEvent["payload"],
      status: "processing",
    });
    if (!claim) {
      const stored = await this.db.findWebhookEvent(provider, eventId);
      return { ok: true as const, handled: stored?.status === "applied", deduplicated: true };
    }

    const p = payload as {
      businessId?: string;
      invoiceId?: string;
      amountMinor?: number;
      planKey?: string;
      status?: string;
      reason?: string;
    };
    const businessId = typeof p.businessId === "string" ? p.businessId : null;
    if (businessId) withScope(businessId, {});

    if (type === "invoice.paid" || type === "invoice.void") {
      if (!businessId) throw new Error("VALIDATION");
      const target = await this.resolveInvoiceForEvent(businessId, p);
      if (type === "invoice.paid") {
        if (target.status !== "open") throw new Error("VALIDATION");
        await this.db.updateInvoice(target.id, businessId, { status: "paid", paidAt: new Date() });
      } else {
        if (target.status === "void") throw new Error("VALIDATION");
        await this.db.updateInvoice(target.id, businessId, { status: "void" });
      }
      await this.db.updateWebhookEventStatus(claim.id, "applied");
      await this.db.appendAudit({
        businessId,
        actorId: "webhook",
        action: type === "invoice.paid" ? "webhook.invoice" : "invoice.void",
        entityType: "Invoice",
        entityId: target.id,
        requestId,
      });
      return { ok: true as const, handled: true, deduplicated: false };
    }

    if (type === "subscription.created" || type === "subscription.updated") {
      if (!businessId || typeof p.planKey !== "string") throw new Error("VALIDATION");
      const status = SUBSCRIPTION_STATUSES.has(p.status ?? "active") ? (p.status as string) : null;
      if (status === null) throw new Error("VALIDATION");
      await this.applySubscriptionState(businessId, requestId, p.planKey, status);
      await this.db.updateWebhookEventStatus(claim.id, "applied");
      return { ok: true as const, handled: true, deduplicated: false };
    }

    await this.db.updateWebhookEventStatus(claim.id, "unhandled");
    return { ok: true as const, handled: false, deduplicated: false };
  }

  // Events name their invoice. Amount is verified when the provider sends it,
  // so a signed-but-wrong event can never mark an unrelated invoice paid.
  private async resolveInvoiceForEvent(
    businessId: string,
    p: { invoiceId?: string; amountMinor?: number },
  ): Promise<DbInvoice> {
    const invoices = await this.db.listInvoices(businessId);
    if (typeof p.invoiceId === "string") {
      const byId = invoices.find((i) => i.id === p.invoiceId);
      if (!byId) throw new Error("NOT_FOUND");
      if (typeof p.amountMinor === "number" && byId.amountMinor !== p.amountMinor) {
        throw new Error("VALIDATION");
      }
      return byId;
    }
    if (typeof p.amountMinor !== "number") throw new Error("VALIDATION");
    const byAmount = invoices.filter((i) => i.amountMinor === p.amountMinor && i.status === "open");
    if (byAmount.length !== 1) throw byAmount.length === 0 ? new Error("NOT_FOUND") : new Error("VALIDATION");
    return byAmount[0]!;
  }

  private async applySubscriptionState(
    businessId: string,
    requestId: string,
    planKey: string,
    status: string,
  ): Promise<void> {
    await this.changePlan(businessId, "webhook", requestId, planKey, status);
    await this.db.appendAudit({
      businessId,
      actorId: "webhook",
      action: status === "trialing" ? "subscription.created" : "subscription.updated",
      entityType: "Subscription",
      entityId: `${planKey}:${status}`,
      requestId,
    });
  }

  async setFlag(businessId: string, actorId: string, requestId: string, key: string, enabled: boolean): Promise<{ key: string; enabled: boolean }> {
    withScope(businessId, {});
    const business = await this.db.findBusinessById(businessId);
    if (!business) throw new Error("NOT_FOUND");
    const row = await this.db.setFlag({ businessId, key, enabled });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "flag.change",
      entityType: "FeatureFlag",
      entityId: `${key}:${enabled}`,
      requestId,
    });
    return { key: row.key, enabled: row.enabled };
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";
import { ENTERPRISE, isTrialExpired, monthPeriod, PLAN_ALLOWANCES, type PlanAllowances } from "../entitlements";

export type CapKind = "users" | "products" | "registers" | "branches";

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

@Injectable()
export class BillingService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async resolvePlan(businessId: string, now: Date = new Date()): Promise<ResolvedPlan> {
    withScope(businessId, {});
    const sub = await this.db.getSubscription(businessId);
    if (!sub) return { key: "enterprise", allowances: ENTERPRISE, monthlyMinor: 0 };
    if (isTrialExpired(sub.status, sub.trialEndsAt, now)) {
      await this.db.updateSubscription(sub.id, businessId, { status: "canceled" });
      await this.db.appendAudit({
        businessId,
        actorId: "system",
        action: "subscription.expired",
        entityType: "Subscription",
        entityId: sub.id,
        requestId: `expiry-${sub.id}`,
      });
      const free = await this.db.findPlanByKey("free");
      return { key: "free", allowances: free?.allowances ?? ENTERPRISE, monthlyMinor: free?.pricesMinor.monthlyMinor ?? 0 };
    }
    return this.allowancesOf(sub.planId);
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
      throw new Error("PLAN_LIMIT");
    }
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
    if (!(await this.checkFeature(businessId, feature))) throw new Error("PLAN_LIMIT");
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

  async changePlan(businessId: string, actorId: string, requestId: string, planKey: string): Promise<{ key: string }> {
    withScope(businessId, {});
    const business = await this.db.findBusinessById(businessId);
    if (!business) throw new Error("NOT_FOUND");
    const allowances = PLAN_ALLOWANCES[planKey];
    if (!allowances) throw new Error("VALIDATION");
    const plan = await this.db.findPlanByKey(planKey);
    if (!plan || !plan.isActive) throw new Error("VALIDATION");
    const existing = await this.db.getSubscription(businessId);
    const periodEnd = new Date(Date.now() + 30 * 86400000);
    if (existing) {
      await this.db.updateSubscription(existing.id, businessId, {
        planId: plan.id, status: "active", trialEndsAt: null, currentPeriodEnd: periodEnd,
      });
    } else {
      await this.db.upsertSubscription({
        businessId, planId: plan.id, status: "active", trialEndsAt: null, currentPeriodEnd: periodEnd,
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
    const sales = (await this.db.listSalesByBusiness(businessId)).length;
    await this.db.setCounter(businessId, "sales.monthly", monthPeriod(new Date()), sales);
    return { checked: kinds.length + 1, drifts };
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
    const sales = (await this.db.listSalesByBusiness(businessId)).length;
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

  async rolloverIfDue(businessId: string, now: Date = new Date()): Promise<void> {
    withScope(businessId, {});
    const sub = await this.db.getSubscription(businessId);
    if (!sub || sub.status !== "active") return;
    if (sub.currentPeriodEnd.getTime() > now.getTime()) return;
    const plan = await this.allowancesOf(sub.planId);
    const periodStart = new Date(sub.currentPeriodEnd.getTime() - 30 * 86400000);
    await this.db.createInvoice({
      businessId,
      subscriptionId: sub.id,
      periodStart,
      periodEnd: sub.currentPeriodEnd,
      amountMinor: plan.monthlyMinor,
      currency: "PHP",
      status: "open",
      paidAt: null,
    });
    await this.db.updateSubscription(sub.id, businessId, {
      currentPeriodEnd: new Date(sub.currentPeriodEnd.getTime() + 30 * 86400000),
    });
    await this.db.appendAudit({
      businessId,
      actorId: "system",
      action: "invoice.issued",
      entityType: "Invoice",
      entityId: `${periodStart.toISOString()}`,
      requestId: `rollover-${sub.id}`,
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
    if (type === "invoice.paid") {
      const p = payload as { businessId?: string; amountMinor?: number };
      if (typeof p.businessId !== "string") throw new Error("VALIDATION");
      withScope(p.businessId, {});
      const open = (await this.db.listInvoices(p.businessId)).find((i) => i.status === "open") ?? null;
      if (!open) throw new Error("NOT_FOUND");
      await this.db.updateInvoice(open.id, p.businessId, { status: "paid", paidAt: new Date() });
      await this.db.createWebhookEvent({ businessId: p.businessId, provider, eventId, type, payload: body, status: "applied" });
      await this.db.appendAudit({
        businessId: p.businessId, actorId: "webhook", action: "webhook.invoice",
        entityType: "Invoice", entityId: open.id, requestId,
      });
      return { ok: true as const, handled: true, deduplicated: false };
    }
    if (type === "subscription.updated") {
      const p = payload as { businessId?: string; planKey?: string };
      if (typeof p.businessId !== "string" || typeof p.planKey !== "string") throw new Error("VALIDATION");
      await this.changePlan(p.businessId, "webhook", requestId, p.planKey);
      await this.db.createWebhookEvent({ businessId: p.businessId, provider, eventId, type, payload: body, status: "applied" });
      return { ok: true as const, handled: true, deduplicated: false };
    }
    await this.db.createWebhookEvent({ businessId: null, provider, eventId, type, payload: body, status: "unhandled" });
    return { ok: true as const, handled: false, deduplicated: false };
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

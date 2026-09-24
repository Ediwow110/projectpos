import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";
import { ENTERPRISE, isTrialExpired, monthPeriod, PLAN_ALLOWANCES, type PlanAllowances } from "../entitlements";

export type CapKind = "users" | "products" | "registers" | "branches";

export interface ResolvedPlan {
  key: string;
  allowances: PlanAllowances;
}

@Injectable()
export class BillingService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async resolvePlan(businessId: string, now: Date = new Date()): Promise<ResolvedPlan> {
    withScope(businessId, {});
    const sub = await this.db.getSubscription(businessId);
    if (!sub) return { key: "enterprise", allowances: ENTERPRISE };
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
      return { key: "free", allowances: free?.allowances ?? ENTERPRISE };
    }
    return this.allowancesOf(sub.planId);
  }

  private async allowancesOf(planId: string): Promise<ResolvedPlan> {
    const plans = await this.db.listPlans();
    const found = plans.find((p) => p.id === planId) ?? null;
    if (!found) return { key: "enterprise", allowances: ENTERPRISE };
    return { key: found.key, allowances: found.allowances };
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

  async rebuildCounters(businessId: string): Promise<{ checked: number; drifts: Array<{ key: string; snapshot: number; live: number }> }> {
    withScope(businessId, {});
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
}

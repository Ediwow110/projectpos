import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";

import type { DbPort } from "../../common/db.port";
import {
  BillingEntitlementService,
  type CapKind,
  type UsageSlice,
} from "../billing-entitlement-service";
import { BillingInvoiceService } from "../billing-invoice-service";
import {
  BillingWebhookService,
  isBillingSubscriptionStatus,
} from "../billing-webhook-service";
import {
  billingEnabled,
  ENTERPRISE,
  isTrialExpired,
  normalizeSubscriptionStatus,
  PLAN_ALLOWANCES,
  type PlanAllowances,
} from "../entitlements";

export { canonicalWebhookBody } from "../billing-webhook-service";
export type { CapKind, UsageSlice } from "../billing-entitlement-service";

export interface ResolvedPlan {
  key: string;
  allowances: PlanAllowances;
  monthlyMinor: number;
}

@Injectable()
export class BillingService {
  private readonly entitlements: BillingEntitlementService;
  private readonly invoices: BillingInvoiceService;
  private readonly webhooks: BillingWebhookService;

  constructor(@Inject("DbPort") private readonly db: DbPort) {
    this.entitlements = new BillingEntitlementService(
      db,
      (businessId) => this.resolvePlan(businessId),
    );
    this.invoices = new BillingInvoiceService(
      db,
      (planId) => this.allowancesOf(planId),
    );
    this.webhooks = new BillingWebhookService(
      db,
      (businessId, actorId, requestId, planKey, status) =>
        this.changePlan(
          businessId,
          actorId,
          requestId,
          planKey,
          status,
        ),
    );
  }

  async resolvePlan(
    businessId: string,
    now: Date = new Date(),
  ): Promise<ResolvedPlan> {
    withScope(businessId, {});
    if (!billingEnabled()) {
      return {
        key: "enterprise",
        allowances: ENTERPRISE,
        monthlyMinor: 0,
      };
    }
    const subscription = await this.db.getSubscription(businessId);
    if (!subscription) {
      return {
        key: "enterprise",
        allowances: ENTERPRISE,
        monthlyMinor: 0,
      };
    }
    if (
      isTrialExpired(
        subscription.status,
        subscription.trialEndsAt,
        now,
      )
    ) {
      return this.downgradeToFree(
        businessId,
        subscription,
        "canceled",
        "subscription.expired",
        "expiry-" + subscription.id,
      );
    }
    const status = normalizeSubscriptionStatus(
      subscription.status,
    );
    if (
      status !== "active" &&
      status !== "past_due" &&
      status !== "trialing"
    ) {
      return this.downgradeToFree(
        businessId,
        subscription,
        "canceled",
        "subscription.canceled",
        "status-" + subscription.id,
      );
    }
    const plan =
      (await this.db.listPlans()).find(
        (candidate) => candidate.id === subscription.planId,
      ) ?? null;
    if (!plan || !plan.isActive) {
      return this.downgradeToFree(
        businessId,
        subscription,
        "canceled",
        "subscription.canceled",
        "plan-" + subscription.id,
      );
    }
    return this.allowancesOf(subscription.planId);
  }

  private async downgradeToFree(
    businessId: string,
    subscription: {
      id: string;
      status: string;
      planId: string;
    },
    status: string,
    action: string,
    requestId: string,
  ): Promise<ResolvedPlan> {
    const free = await this.db.findPlanByKey("free");
    if (!free) throw new Error("VALIDATION");
    if (
      subscription.status !== status ||
      subscription.planId !== free.id
    ) {
      await this.db.updateSubscription(
        subscription.id,
        businessId,
        {
          planId: free.id,
          status,
          trialEndsAt: null,
        },
      );
      await this.db.appendAudit({
        businessId,
        actorId: "system",
        action,
        entityType: "Subscription",
        entityId: subscription.id,
        requestId,
      });
    }
    return {
      key: free.key,
      allowances: free.allowances,
      monthlyMinor: free.pricesMinor.monthlyMinor,
    };
  }

  private async allowancesOf(
    planId: string,
  ): Promise<ResolvedPlan> {
    const plans = await this.db.listPlans();
    const found =
      plans.find((plan) => plan.id === planId) ?? null;
    if (!found) {
      return {
        key: "enterprise",
        allowances: ENTERPRISE,
        monthlyMinor: 0,
      };
    }
    return {
      key: found.key,
      allowances: found.allowances,
      monthlyMinor: found.pricesMinor.monthlyMinor,
    };
  }

  async requireCreate(
    businessId: string,
    actorId: string,
    requestId: string,
    kind: CapKind,
  ): Promise<void> {
    return this.entitlements.requireCreate(
      businessId,
      actorId,
      requestId,
      kind,
    );
  }

  async withCap<T>(
    businessId: string,
    actorId: string,
    requestId: string,
    kind: CapKind,
    write: () => Promise<T>,
  ): Promise<T> {
    return this.entitlements.withCap(
      businessId,
      actorId,
      requestId,
      kind,
      write,
    );
  }

  async checkFeature(
    businessId: string,
    feature: string,
  ): Promise<boolean> {
    return this.entitlements.checkFeature(
      businessId,
      feature,
    );
  }

  async withCapBatch<T>(
    businessId: string,
    actorId: string,
    requestId: string,
    kind: CapKind,
    count: number,
    write: () => Promise<T>,
  ): Promise<T> {
    return this.entitlements.withCapBatch(
      businessId,
      actorId,
      requestId,
      kind,
      count,
      write,
    );
  }

  async requireFeature(
    businessId: string,
    feature: string,
    actorId = "system",
    requestId = "feature-gate",
  ): Promise<void> {
    return this.entitlements.requireFeature(
      businessId,
      feature,
      actorId,
      requestId,
    );
  }

  async recordUsage(
    businessId: string,
    key: string,
    period: string,
  ): Promise<void> {
    return this.entitlements.recordUsage(
      businessId,
      key,
      period,
    );
  }

  async recordSale(
    businessId: string,
    completedAt: Date = new Date(),
  ): Promise<void> {
    return this.entitlements.recordSale(
      businessId,
      completedAt,
    );
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
    if (!isBillingSubscriptionStatus(status)) {
      throw new Error("VALIDATION");
    }
    const plan = await this.db.findPlanByKey(planKey);
    if (!plan || !plan.isActive) {
      throw new Error("VALIDATION");
    }
    return this.db.withLock(
      "billing:" + businessId,
      async () => {
        const existing =
          await this.db.getSubscription(businessId);
        const periodEnd = new Date(
          Date.now() + 30 * 86400000,
        );
        const trialEndsAt =
          status === "trialing"
            ? new Date(Date.now() + 14 * 86400000)
            : null;
        if (existing) {
          await this.db.updateSubscription(
            existing.id,
            businessId,
            {
              planId: plan.id,
              status,
              trialEndsAt,
              currentPeriodEnd: periodEnd,
            },
          );
        } else {
          await this.db.upsertSubscription({
            businessId,
            planId: plan.id,
            status,
            trialEndsAt,
            currentPeriodEnd: periodEnd,
          });
        }
        await this.db.appendAudit({
          businessId,
          actorId,
          action: "plan.change",
          entityType: "Subscription",
          entityId: planKey,
          requestId,
          reason: "plan " + planKey + " -> " + status,
        });
        return { key: planKey };
      },
    );
  }

  async rebuildCounters(
    businessId: string,
  ): Promise<{
    checked: number;
    drifts: Array<{
      key: string;
      snapshot: number;
      live: number;
    }>;
  }> {
    return this.entitlements.rebuildCounters(businessId);
  }

  async listInvoices(businessId: string) {
    return this.invoices.listInvoices(businessId);
  }

  async usageSummary(
    businessId: string,
  ): Promise<{
    users: UsageSlice;
    products: UsageSlice;
    registers: UsageSlice;
    branches: UsageSlice;
    salesMonthly: number;
  }> {
    return this.entitlements.usageSummary(businessId);
  }

  async getSubscription(
    businessId: string,
  ): Promise<{
    planKey: string;
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    usage: {
      users: UsageSlice;
      products: UsageSlice;
      registers: UsageSlice;
      branches: UsageSlice;
      salesMonthly: number;
    };
  }> {
    withScope(businessId, {});
    await this.rolloverIfDue(businessId);
    const plan = await this.resolvePlan(businessId);
    const subscription =
      await this.db.getSubscription(businessId);
    return {
      planKey: plan.key,
      status: subscription?.status ?? "active",
      trialEndsAt: subscription?.trialEndsAt ?? null,
      currentPeriodEnd:
        subscription?.currentPeriodEnd ?? null,
      usage: await this.usageSummary(businessId),
    };
  }

  async rolloverIfDue(
    businessId: string,
    now: Date = new Date(),
  ): Promise<void> {
    return this.invoices.rolloverIfDue(businessId, now);
  }

  async issueInvoice(
    businessId: string,
    actorId: string,
    requestId: string,
    input: {
      periodStart: Date;
      periodEnd: Date;
    },
  ): Promise<{
    id: string;
    amountMinor: number;
    status: string;
  }> {
    return this.invoices.issueInvoice(
      businessId,
      actorId,
      requestId,
      input,
    );
  }

  async ingestWebhook(
    provider: string,
    eventId: string,
    type: string,
    payload: unknown,
    signature: string | undefined,
    requestId: string,
    rawBody?: string,
  ): Promise<{
    ok: true;
    handled: boolean;
    deduplicated: boolean;
  }> {
    return this.webhooks.ingest(
      provider,
      eventId,
      type,
      payload,
      signature,
      requestId,
      rawBody,
    );
  }

  async setFlag(
    businessId: string | null,
    actorId: string,
    requestId: string,
    key: string,
    enabled: boolean,
  ): Promise<{ key: string; enabled: boolean }> {
    withScope(businessId ?? "platform", {});
    if (businessId) {
      const business =
        await this.db.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
    }
    const row = await this.db.setFlag({
      businessId,
      key,
      enabled,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: businessId ? "flag.change" : "flag.global",
      entityType: "FeatureFlag",
      entityId: key + ":" + String(enabled),
      requestId,
      reason:
        "flag " +
        key +
        "=" +
        String(enabled) +
        (businessId ? "" : " (global)"),
    });
    return { key: row.key, enabled: row.enabled };
  }

  async auditGrantUse(
    businessId: string | null,
    grantId: string,
    purpose: string,
    requestId: string,
  ): Promise<void> {
    await this.db.appendAudit({
      businessId,
      actorId: "platform",
      action: "platform.grant.use",
      entityType: "PlatformSupportGrant",
      entityId: grantId,
      requestId,
      reason: purpose,
    });
  }
}

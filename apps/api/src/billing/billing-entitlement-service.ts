import { withScope } from "@pos/database";

import type { DbPort } from "../common/db.port";
import { PlanLimitError } from "../common/plan-limit-error";
import { isSettled } from "../reports/aggregate";
import { monthPeriod, type PlanAllowances } from "./entitlements";

export type CapKind = "users" | "products" | "registers" | "branches";

export interface UsageSlice {
  used: number;
  limit: number | null;
}

export interface BillingEntitlementPlan {
  key: string;
  allowances: PlanAllowances;
  monthlyMinor: number;
}

type BillingEntitlementPort = Pick<
  DbPort,
  | "appendAudit"
  | "getFlag"
  | "listBranchesByBusiness"
  | "listCounters"
  | "listMembershipsByBusiness"
  | "listProducts"
  | "listRegisters"
  | "listSalesByBusiness"
  | "setCounter"
  | "withLock"
>;

export class BillingEntitlementService {
  constructor(
    private readonly db: BillingEntitlementPort,
    private readonly resolvePlan: (
      businessId: string,
    ) => Promise<BillingEntitlementPlan>,
  ) {}

  private async liveCount(
    businessId: string,
    kind: CapKind,
  ): Promise<number> {
    if (kind === "users") {
      return (
        await this.db.listMembershipsByBusiness(businessId)
      ).filter((membership) => !membership.deactivatedAt).length;
    }
    if (kind === "products") {
      return (await this.db.listProducts(businessId)).length;
    }
    if (kind === "registers") {
      return (await this.db.listRegisters(businessId)).length;
    }
    return (await this.db.listBranchesByBusiness(businessId)).length;
  }

  async requireCreate(
    businessId: string,
    actorId: string,
    requestId: string,
    kind: CapKind,
  ): Promise<void> {
    withScope(businessId, {});
    const plan = await this.resolvePlan(businessId);
    const limit = plan.allowances[kind];
    const used = await this.liveCount(businessId, kind);
    await this.db.setCounter(
      businessId,
      `cap.${kind}`,
      "all-time",
      used,
    );
    if (limit !== null && used >= limit) {
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "plan.limit",
        entityType: "Business",
        entityId: `${kind}:${used}/${limit}`,
        requestId,
      });
      throw new PlanLimitError({
        limit,
        used,
        plan: plan.key,
        resource: kind,
      });
    }
  }

  async withCap<T>(
    businessId: string,
    actorId: string,
    requestId: string,
    kind: CapKind,
    write: () => Promise<T>,
  ): Promise<T> {
    return this.db.withLock(`billing:${businessId}`, async () => {
      await this.requireCreate(
        businessId,
        actorId,
        requestId,
        kind,
      );
      const out = await write();
      await this.db.setCounter(
        businessId,
        `cap.${kind}`,
        "all-time",
        await this.liveCount(businessId, kind),
      );
      return out;
    });
  }

  async checkFeature(
    businessId: string,
    feature: string,
  ): Promise<boolean> {
    withScope(businessId, {});
    const override = await this.db.getFlag(businessId, feature);
    if (override) return override.enabled;
    const global = await this.db.getFlag(null, feature);
    if (global) return global.enabled;
    const plan = await this.resolvePlan(businessId);
    return plan.allowances.features.includes(feature);
  }

  async withCapBatch<T>(
    businessId: string,
    actorId: string,
    requestId: string,
    kind: CapKind,
    count: number,
    write: () => Promise<T>,
  ): Promise<T> {
    return this.db.withLock(`billing:${businessId}`, async () => {
      const plan = await this.resolvePlan(businessId);
      const limit = plan.allowances[kind];
      const used = await this.liveCount(businessId, kind);
      if (limit !== null && used + count > limit) {
        await this.db.setCounter(
          businessId,
          `cap.${kind}`,
          "all-time",
          used,
        );
        await this.db.appendAudit({
          businessId,
          actorId,
          action: "plan.limit",
          entityType: "Business",
          entityId: `${kind}:${used}+${count}/${limit}`,
          requestId,
        });
        throw new PlanLimitError({
          limit,
          used,
          plan: plan.key,
          resource: kind,
        });
      }
      const out = await write();
      await this.db.setCounter(
        businessId,
        `cap.${kind}`,
        "all-time",
        await this.liveCount(businessId, kind),
      );
      return out;
    });
  }

  async requireFeature(
    businessId: string,
    feature: string,
    actorId = "system",
    requestId = "feature-gate",
  ): Promise<void> {
    if (await this.checkFeature(businessId, feature)) return;
    const plan = await this.resolvePlan(businessId);
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "plan.limit",
      entityType: "Feature",
      entityId: feature,
      requestId,
    });
    throw new PlanLimitError({ feature, plan: plan.key });
  }

  async recordUsage(
    businessId: string,
    key: string,
    period: string,
  ): Promise<void> {
    withScope(businessId, {});
    const existing = (await this.db.listCounters(businessId)).find(
      (counter) =>
        counter.key === key && counter.period === period,
    );
    await this.db.setCounter(
      businessId,
      key,
      period,
      (existing?.count ?? 0) + 1,
    );
  }

  async recordSale(
    businessId: string,
    completedAt: Date = new Date(),
  ): Promise<void> {
    await this.recordUsage(
      businessId,
      "sales.monthly",
      monthPeriod(completedAt),
    );
  }

  private async monthlySaleCount(
    businessId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const [year, month] = monthPeriod(now)
      .split("-")
      .map((value) => Number(value));
    return (await this.db.listSalesByBusiness(businessId)).filter(
      (sale) => {
        if (!isSettled(sale.status)) return false;
        const at = new Date(sale.completedAt ?? sale.createdAt);
        return (
          at.getUTCFullYear() === year &&
          at.getUTCMonth() + 1 === month
        );
      },
    ).length;
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
    withScope(businessId, {});
    const kinds: CapKind[] = [
      "users",
      "products",
      "registers",
      "branches",
    ];
    const snapshots = await this.db.listCounters(businessId);
    const drifts: Array<{
      key: string;
      snapshot: number;
      live: number;
    }> = [];
    for (const kind of kinds) {
      const live = await this.liveCount(businessId, kind);
      const snapshot = snapshots.find(
        (counter) =>
          counter.key === `cap.${kind}` &&
          counter.period === "all-time",
      );
      await this.db.setCounter(
        businessId,
        `cap.${kind}`,
        "all-time",
        live,
      );
      if (snapshot && snapshot.count !== live) {
        drifts.push({
          key: `cap.${kind}`,
          snapshot: snapshot.count,
          live,
        });
      }
    }
    const period = monthPeriod(new Date());
    const sales = await this.monthlySaleCount(businessId);
    const salesSnapshot = snapshots.find(
      (counter) =>
        counter.key === "sales.monthly" &&
        counter.period === period,
    );
    await this.db.setCounter(
      businessId,
      "sales.monthly",
      period,
      sales,
    );
    if (salesSnapshot && salesSnapshot.count !== sales) {
      drifts.push({
        key: `sales.monthly:${period}`,
        snapshot: salesSnapshot.count,
        live: sales,
      });
    }
    return { checked: kinds.length + 1, drifts };
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
    const plan = await this.resolvePlan(businessId);
    const [users, products, registers, branches] =
      await Promise.all([
        this.liveCount(businessId, "users"),
        this.liveCount(businessId, "products"),
        this.liveCount(businessId, "registers"),
        this.liveCount(businessId, "branches"),
      ]);
    const sales = await this.monthlySaleCount(businessId);
    return {
      users: { used: users, limit: plan.allowances.users },
      products: {
        used: products,
        limit: plan.allowances.products,
      },
      registers: {
        used: registers,
        limit: plan.allowances.registers,
      },
      branches: {
        used: branches,
        limit: plan.allowances.branches,
      },
      salesMonthly: sales,
    };
  }
}

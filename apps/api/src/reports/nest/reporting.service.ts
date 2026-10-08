import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";

import { BillingService } from "../../billing/nest/billing.service";
import type { DbPort } from "../../common/db.port";
import { deriveStockStatus } from "../../inventory/projection";
import { sumCashComponents } from "../../shifts/cash";
import { bucketRange } from "../aggregate";
import { revenueSeries } from "../reporting-series";
import { ReportingBreakdownService } from "../reporting-breakdown-service";
import {
  ReportingCore,
  type Kpi,
  type ReportQuery,
  type SeriesPoint,
} from "../reporting-core";

export type { Kpi, ReportQuery, SeriesPoint } from "../reporting-core";

@Injectable()
export class ReportingService {
  private readonly breakdowns: ReportingBreakdownService;
  private readonly core: ReportingCore;

  constructor(@Inject("DbPort") private readonly db: DbPort) {
    this.breakdowns = new ReportingBreakdownService(db);
    this.core = new ReportingCore(db);
  }

  async getOverview(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ): Promise<{
    kpis: {
      netRevenue: Kpi;
      merchandiseRevenue: Kpi;
      deliveryRevenue: Kpi;
      deliveryTax: Kpi;
      orders: Kpi;
      avgOrder: Kpi;
      grossProfit?: Kpi;
      refundTotal: Kpi;
      discountTotal: Kpi;
      expenseTotal: Kpi;
    };
    series: SeriesPoint[];
    topProducts: Array<{
      productId: string;
      name: string;
      qty: number;
      revenue: number;
    }>;
    attention: Array<{
      kind: string;
      label: string;
      href: string;
      count: number;
    }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, prev, compare, label } = this.core.resolved(query);
    const billing = new BillingService(this.db);
    const canSeeExpenses = await billing.checkFeature(
      businessId,
      "expenses",
    );
    const sales = await this.core.settledSales(
      businessId,
      range,
      query.registerId,
      query.branchId,
    );
    const withLines = await this.core.linesFor(businessId, sales);
    const cur = this.core.metricsFromLines(withLines);
    const curExpenses = canSeeExpenses
      ? await this.core.expensesTotal(businessId, range)
      : null;
    const old = prev
      ? await this.core.metrics(
          businessId,
          prev,
          query.registerId,
          query.branchId,
        )
      : null;
    const oldExpenses =
      canSeeExpenses && prev
        ? await this.core.expensesTotal(businessId, prev)
        : null;
    const canSeeProfit = granted.includes("cost.view");
    const kpis: {
      netRevenue: Kpi;
      merchandiseRevenue: Kpi;
      deliveryRevenue: Kpi;
      deliveryTax: Kpi;
      orders: Kpi;
      avgOrder: Kpi;
      grossProfit?: Kpi;
      refundTotal: Kpi;
      discountTotal: Kpi;
      expenseTotal: Kpi;
    } = {
      netRevenue: this.core.kpi(
        cur.netRevenue,
        old?.netRevenue ?? null,
      ),
      merchandiseRevenue: this.core.kpi(
        cur.merchandiseRevenue,
        old?.merchandiseRevenue ?? null,
      ),
      deliveryRevenue: this.core.kpi(
        cur.deliveryRevenue,
        old?.deliveryRevenue ?? null,
      ),
      deliveryTax: this.core.kpi(
        cur.deliveryTax,
        old?.deliveryTax ?? null,
      ),
      orders: this.core.kpi(cur.orders, old?.orders ?? null),
      avgOrder: this.core.kpi(cur.avgOrder, old?.avgOrder ?? null),
      refundTotal: this.core.kpi(
        cur.refundTotal,
        old?.refundTotal ?? null,
      ),
      discountTotal: this.core.kpi(
        cur.discountTotal,
        old?.discountTotal ?? null,
      ),
      expenseTotal: this.core.kpiMaybe(curExpenses, oldExpenses),
    };
    if (canSeeProfit) {
      kpis.grossProfit = this.core.kpi(
        cur.grossProfit,
        old?.grossProfit ?? null,
      );
    }
    const granularity = "day";
    const buckets = bucketRange(range.from, range.to, granularity);
    const series: SeriesPoint[] = revenueSeries(buckets, granularity, withLines);
    const aggregate = new Map<
      string,
      { name: string; qty: number; revenue: number }
    >();
    for (const sale of withLines) {
      for (const line of sale.items) {
        const row = aggregate.get(line.productId) ?? {
          name: line.name,
          qty: 0,
          revenue: 0,
        };
        row.qty += line.qty;
        row.revenue += line.lineTotalMinor;
        aggregate.set(line.productId, row);
      }
    }
    const topProducts = [...aggregate.entries()]
      .map(([productId, row]) => ({ productId, ...row }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    const attention = await this.attentionFor(
      businessId,
      query.branchId,
    );
    return {
      kpis,
      series,
      topProducts,
      attention,
      generatedAt: new Date().toISOString(),
      range: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      compare,
      compareLabel: label,
    };
  }

  private async attentionFor(
    businessId: string,
    branchId?: string,
  ): Promise<
    Array<{
      kind: string;
      label: string;
      href: string;
      count: number;
    }>
  > {
    const out: Array<{
      kind: string;
      label: string;
      href: string;
      count: number;
    }> = [];
    const [products, balances, shifts, sales, payments] =
      await Promise.all([
        this.db.listProducts(businessId),
        this.db.listBalances(businessId),
        this.db.listShiftsByBusiness(businessId),
        this.db.listSalesByBusiness(businessId),
        this.db.listPaymentsByBusiness(businessId),
      ]);
    const targetBranch = branchId ?? null;
    const balanceByProduct = new Map(
      balances
        .filter(
          (balance) =>
            (balance.branchId ?? null) === targetBranch,
        )
        .map((balance) => [balance.productId, balance]),
    );
    let low = 0;
    let outCount = 0;
    for (const product of products) {
      if (!product.isActive) continue;
      const balance = balanceByProduct.get(product.id) ?? null;
      const status = deriveStockStatus({
        qtyOnHand: balance?.qtyOnHand ?? 0,
        reorderLevel: product.reorderLevel,
        trackInventory: product.trackInventory,
      });
      if (status === "low") low += 1;
      if (status === "out") outCount += 1;
    }
    if (low > 0) {
      out.push({
        kind: "low_stock",
        label: `${low} products low on stock`,
        href: "/inventory",
        count: low,
      });
    }
    if (outCount > 0) {
      out.push({
        kind: "out_of_stock",
        label: `${outCount} products out of stock`,
        href: "/inventory",
        count: outCount,
      });
    }
    const open = shifts.filter((shift) => shift.status === "OPEN")
      .length;
    if (open > 0) {
      out.push({
        kind: "open_shifts",
        label: `${open} shifts open`,
        href: "/shifts",
        count: open,
      });
    }
    const pending = sales.filter(
      (sale) => sale.status === "REFUND_REQUESTED",
    ).length;
    const unknown = payments.filter(
      (payment) => payment.status === "UNKNOWN",
    ).length;
    if (unknown > 0) {
      out.push({
        kind: "unknown_payments",
        label: `${unknown} payments need reconciliation`,
        href: "/sales?status=PAYMENT_UNKNOWN",
        count: unknown,
      });
    }
    if (pending > 0) {
      out.push({
        kind: "pending_refunds",
        label: `${pending} refunds awaiting approval`,
        href: "/sales?status=REFUND_REQUESTED",
        count: pending,
      });
    }
    return out;
  }

  async getSalesReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ) {
    withScope(businessId, {});
    void role;
    const { range, compare, label } = this.core.resolved(query);
    const granularity =
      query.granularity === "hour" ? "hour" : "day";
    await new BillingService(this.db).requireFeature(
      businessId,
      "reports",
    );
    const cur = await this.core.metrics(
      businessId,
      range,
      query.registerId,
      query.branchId,
    );
    const buckets = bucketRange(
      range.from,
      range.to,
      granularity,
    );
    const withLines = await this.core.linesFor(
      businessId,
      await this.core.settledSales(
        businessId,
        range,
        query.registerId,
        query.branchId,
      ),
    );
    const series = revenueSeries(buckets, granularity, withLines);
    return {
      totals: {
        netRevenue: cur.netRevenue,
        merchandiseRevenue: cur.merchandiseRevenue,
        deliveryRevenue: cur.deliveryRevenue,
        deliveryTax: cur.deliveryTax,
        orders: cur.orders,
        avgOrder: cur.avgOrder,
        grossProfit: granted.includes("cost.view")
          ? cur.grossProfit
          : null,
        refundTotal: cur.refundTotal,
        discountTotal: cur.discountTotal,
      },
      series,
      generatedAt: new Date().toISOString(),
      range: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      compare,
      compareLabel: label,
    };
  }

  async getProductsReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ) {
    return this.breakdowns.getProductsReport(
      businessId,
      query,
      role,
      granted,
    );
  }

  async getInventoryReport(
    businessId: string,
    branchId?: string,
  ) {
    return this.breakdowns.getInventoryReport(
      businessId,
      branchId,
    );
  }

  async getPaymentsReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ) {
    withScope(businessId, {});
    void role;
    void granted;
    await new BillingService(this.db).requireFeature(
      businessId,
      "reports",
    );
    const { range, compare, label } = this.core.resolved(query);
    const sales = await this.core.settledSales(
      businessId,
      range,
      query.registerId,
    );
    const byMethod = new Map<
      string,
      { total: number; count: number }
    >();
    let unknown = 0;
    let refunded = 0;
    for (const sale of sales) {
      for (const payment of await this.db.listPaymentsBySale(
        sale.id,
        businessId,
      )) {
        if (payment.status === "SUCCEEDED") {
          const row = byMethod.get(payment.method) ?? {
            total: 0,
            count: 0,
          };
          row.total += payment.amountMinor;
          row.count += 1;
          byMethod.set(payment.method, row);
        } else if (payment.status === "UNKNOWN") {
          unknown += 1;
        } else if (payment.status === "REFUNDED") {
          refunded += payment.amountMinor;
        }
      }
    }
    return {
      byMethod: [...byMethod.entries()]
        .map(([method, row]) => ({ method, ...row }))
        .sort((a, b) => b.total - a.total),
      unknown,
      refunded,
      generatedAt: new Date().toISOString(),
      range: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      compare,
      compareLabel: label,
    };
  }

  async getCashReport(
    businessId: string,
    query: ReportQuery,
  ) {
    withScope(businessId, {});
    await new BillingService(this.db).requireFeature(
      businessId,
      "reports",
    );
    let shifts = await this.db.listShiftsByBusiness(businessId);
    if (query.registerId) {
      shifts = shifts.filter(
        (shift) => shift.registerId === query.registerId,
      );
    }
    if (query.branchId) {
      shifts = shifts.filter(
        (shift) => (shift.branchId ?? null) === query.branchId,
      );
    }
    shifts = [...shifts]
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, 100);
    const out: Array<{
      shiftId: string;
      registerId: string;
      status: string;
      expectedCash: number;
      countedCash: number | null;
      variance: number | null;
    }> = [];
    for (const shift of shifts) {
      if (shift.status === "CLOSED") {
        out.push({
          shiftId: shift.id,
          registerId: shift.registerId,
          status: shift.status,
          expectedCash: shift.expectedCashMinor,
          countedCash: shift.countedCashMinor,
          variance: shift.varianceMinor,
        });
      } else {
        const movements =
          await this.db.listCashMovementsByShift(
            shift.id,
            businessId,
          );
        const sums = sumCashComponents(movements);
        out.push({
          shiftId: shift.id,
          registerId: shift.registerId,
          status: shift.status,
          expectedCash:
            shift.openingFloatMinor +
            sums.cashSales -
            sums.cashRefunds -
            sums.cashExpenses +
            sums.cashDeposits -
            sums.cashWithdrawals +
            sums.adjustments,
          countedCash: null,
          variance: null,
        });
      }
    }
    return {
      shifts: out,
      generatedAt: new Date().toISOString(),
    };
  }

  async getBranchesReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ) {
    return this.breakdowns.getBranchesReport(
      businessId,
      query,
      role,
      granted,
    );
  }

  async getCustomersReport(
    businessId: string,
    query: {
      dateFrom?: string;
      dateTo?: string;
      compare?: string;
    },
    role: string,
  ) {
    return this.breakdowns.getCustomersReport(
      businessId,
      query,
      role,
    );
  }

  async getCashiersReport(
    businessId: string,
    query: ReportQuery,
    role: string,
  ) {
    return this.breakdowns.getCashiersReport(
      businessId,
      query,
      role,
    );
  }
}

import { Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbPort, DbSale, DbSaleItem } from "../../common/db.port";
import {
  bucketKey,
  bucketRange,
  compareLabel,
  delta,
  isSettled,
  previousRange,
  resolveRange,
  type DateRange,
} from "../aggregate";
import { deriveStockStatus } from "../../inventory/projection";

export interface ReportQuery {
  dateFrom?: string;
  dateTo?: string;
  compare?: string;
  registerId?: string;
  granularity?: "day" | "hour";
  tab?: string;
  limit?: number;
}

export interface Kpi {
  value: number;
  previous: number | null;
  deltaMinor: number | null;
  deltaPct: number | null;
}

export interface SeriesPoint {
  bucket: string;
  netRevenue: number;
  orders: number;
}

interface SaleWithLines {
  sale: DbSale;
  items: DbSaleItem[];
  refunded: number;
}

@Injectable()
export class ReportingService {
  constructor(private readonly db: DbPort) {}

  private resolved(query: ReportQuery): { range: DateRange; prev: DateRange | null; compare: string; label: string } {
    const compare = query.compare ?? "previous_period";
    const range = resolveRange(query.dateFrom, query.dateTo);
    return { range, prev: previousRange(range, compare), compare, label: compareLabel(range, compare) };
  }

  private inRange(d: Date, range: DateRange): boolean {
    return d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime();
  }

  private async settledSales(
    businessId: string,
    range: DateRange,
    registerId?: string,
  ): Promise<DbSale[]> {
    const all = await this.db.listSalesByBusiness(businessId);
    return all.filter(
      (s) =>
        isSettled(s.status) &&
        this.inRange(s.createdAt, range) &&
        (!registerId || s.registerId === registerId),
    );
  }

  private async linesFor(businessId: string, sales: DbSale[]): Promise<SaleWithLines[]> {
    const out: SaleWithLines[] = [];
    for (const sale of sales) {
      const items = await this.db.listSaleItems(sale.id, businessId);
      const refundItems = await this.db.listRefundItemsBySale(sale.id, businessId);
      const refunded = refundItems.reduce((sum, r) => sum + r.amountMinor, 0);
      out.push({ sale, items, refunded });
    }
    return out;
  }

  private kpi(value: number, previous: number | null): Kpi {
    if (previous === null) {
      return { value, previous, deltaMinor: null, deltaPct: null };
    }
    const d = delta(value, previous);
    return { value, previous, deltaMinor: d.deltaMinor, deltaPct: d.deltaPct };
  }

  private profitOf(lines: SaleWithLines[], businessId: string): Promise<number> {
    void businessId;
    let profit = 0;
    const jobs = lines.map(async (s) => {
      let p = 0;
      for (const l of s.items) p += l.lineTotalMinor - l.costMinor * l.qty;
      const refundItems = await this.db.listRefundItemsBySale(s.sale.id, s.sale.businessId);
      const byLine = new Map(s.items.map((l) => [l.id, l.costMinor]));
      for (const r of refundItems) p -= (byLine.get(r.saleItemId) ?? 0) * r.qty;
      return p;
    });
    return Promise.all(jobs).then((parts) => parts.reduce((a, b) => a + b, profit));
  }

  private async metrics(
    businessId: string,
    range: DateRange,
    registerId?: string,
  ): Promise<{
    netRevenue: number;
    orders: number;
    avgOrder: number;
    grossProfit: number;
    refundTotal: number;
    discountTotal: number;
  }> {
    const sales = await this.settledSales(businessId, range, registerId);
    const withLines = await this.linesFor(businessId, sales);
    const gross = withLines.reduce((sum, s) => sum + s.sale.totalMinor, 0);
    const refundTotal = withLines.reduce((sum, s) => sum + s.refunded, 0);
    const netRevenue = gross - refundTotal;
    const orders = withLines.length;
    return {
      netRevenue,
      orders,
      avgOrder: orders === 0 ? 0 : netRevenue / orders,
      grossProfit: await this.profitOf(withLines, businessId),
      refundTotal,
      discountTotal: withLines.reduce((sum, s) => sum + s.sale.discountMinor, 0),
    };
  }

  private async expensesTotal(businessId: string, range: DateRange): Promise<number> {
    const all = await this.db.listExpensesByBusiness(businessId);
    return all
      .filter((e) => e.voidedAt === null && this.inRange(e.expenseDate, range))
      .reduce((sum, e) => sum + e.amountMinor, 0);
  }

  async getOverview(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ): Promise<{
    kpis: {
      netRevenue: Kpi;
      orders: Kpi;
      avgOrder: Kpi;
      grossProfit?: Kpi;
      refundTotal: Kpi;
      discountTotal: Kpi;
      expenseTotal: Kpi;
    };
    series: SeriesPoint[];
    topProducts: Array<{ productId: string; name: string; qty: number; revenue: number }>;
    attention: Array<{ kind: string; label: string; href: string; count: number }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, prev, compare, label } = this.resolved(query);
    const cur = await this.metrics(businessId, range, query.registerId);
    const curExpenses = await this.expensesTotal(businessId, range);
    const old = prev ? await this.metrics(businessId, prev, query.registerId) : null;
    const oldExpenses = prev ? await this.expensesTotal(businessId, prev) : null;
    const canSeeProfit = granted.includes("cost.view");
    const kpis: {
      netRevenue: Kpi;
      orders: Kpi;
      avgOrder: Kpi;
      grossProfit?: Kpi;
      refundTotal: Kpi;
      discountTotal: Kpi;
      expenseTotal: Kpi;
    } = {
      netRevenue: this.kpi(cur.netRevenue, old?.netRevenue ?? null),
      orders: this.kpi(cur.orders, old?.orders ?? null),
      avgOrder: this.kpi(cur.avgOrder, old?.avgOrder ?? null),
      refundTotal: this.kpi(cur.refundTotal, old?.refundTotal ?? null),
      discountTotal: this.kpi(cur.discountTotal, old?.discountTotal ?? null),
      expenseTotal: this.kpi(curExpenses, oldExpenses),
    };
    if (canSeeProfit) kpis.grossProfit = this.kpi(cur.grossProfit, old?.grossProfit ?? null);
    const granularity = "day";
    const buckets = bucketRange(range.from, range.to, granularity);
    const byBucket = new Map<string, { netRevenue: number; orders: number }>();
    for (const b of buckets) byBucket.set(b, { netRevenue: 0, orders: 0 });
    const sales = await this.settledSales(businessId, range, query.registerId);
    const withLines = await this.linesFor(businessId, sales);
    for (const s of withLines) {
      const key = bucketKey(s.sale.createdAt, granularity);
      const slot = byBucket.get(key);
      if (!slot) continue;
      slot.netRevenue += s.sale.totalMinor - s.refunded;
      slot.orders += 1;
    }
    const series: SeriesPoint[] = buckets.map((bucket) => ({ bucket, ...byBucket.get(bucket)! }));
    const agg = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const s of withLines) {
      for (const l of s.items) {
        const row = agg.get(l.productId) ?? { name: l.name, qty: 0, revenue: 0 };
        row.qty += l.qty;
        row.revenue += l.lineTotalMinor;
        agg.set(l.productId, row);
      }
    }
    const topProducts = [...agg.entries()]
      .map(([productId, r]) => ({ productId, ...r }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    const attention = await this.attentionFor(businessId);
    return {
      kpis,
      series,
      topProducts,
      attention,
      generatedAt: new Date().toISOString(),
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      compare,
      compareLabel: label,
    };
  }

  private async attentionFor(
    businessId: string,
  ): Promise<Array<{ kind: string; label: string; href: string; count: number }>> {
    const out: Array<{ kind: string; label: string; href: string; count: number }> = [];
    const products = await this.db.listProducts(businessId);
    let low = 0;
    let outCount = 0;
    for (const p of products) {
      if (!p.isActive) continue;
      const bal = await this.db.findBalance(p.id, businessId);
      const status = deriveStockStatus({
        qtyOnHand: bal?.qtyOnHand ?? 0,
        reorderLevel: p.reorderLevel,
        trackInventory: p.trackInventory,
      });
      if (status === "low") low += 1;
      if (status === "out") outCount += 1;
    }
    if (low > 0) out.push({ kind: "low_stock", label: `${low} products low on stock`, href: "/inventory", count: low });
    if (outCount > 0) {
      out.push({ kind: "out_of_stock", label: `${outCount} products out of stock`, href: "/inventory", count: outCount });
    }
    const shifts = await this.db.listShiftsByBusiness(businessId);
    const open = shifts.filter((s) => s.status === "OPEN").length;
    if (open > 0) out.push({ kind: "open_shifts", label: `${open} shifts open`, href: "/shifts", count: open });
    const sales = await this.db.listSalesByBusiness(businessId);
    let unknown = 0;
    let pending = 0;
    for (const s of sales) {
      if (s.status === "REFUND_REQUESTED") pending += 1;
      const payments = await this.db.listPaymentsBySale(s.id, businessId);
      unknown += payments.filter((p) => p.status === "UNKNOWN").length;
    }
    if (unknown > 0) {
      out.push({ kind: "unknown_payments", label: `${unknown} payments need reconciliation`, href: "/sales?status=PAYMENT_UNKNOWN", count: unknown });
    }
    if (pending > 0) {
      out.push({ kind: "pending_refunds", label: `${pending} refunds awaiting approval`, href: "/sales?status=REFUND_REQUESTED", count: pending });
    }
    return out;
  }

  async getSalesReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ): Promise<{
    totals: { netRevenue: number; orders: number; avgOrder: number; grossProfit: number | null; refundTotal: number; discountTotal: number };
    series: SeriesPoint[];
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, compare, label } = this.resolved(query);
    const granularity = query.granularity === "hour" ? "hour" : "day";
    const cur = await this.metrics(businessId, range, query.registerId);
    const buckets = bucketRange(range.from, range.to, granularity);
    const byBucket = new Map<string, { netRevenue: number; orders: number }>();
    for (const b of buckets) byBucket.set(b, { netRevenue: 0, orders: 0 });
    const withLines = await this.linesFor(businessId, await this.settledSales(businessId, range, query.registerId));
    for (const s of withLines) {
      const slot = byBucket.get(bucketKey(s.sale.createdAt, granularity));
      if (!slot) continue;
      slot.netRevenue += s.sale.totalMinor - s.refunded;
      slot.orders += 1;
    }
    return {
      totals: {
        netRevenue: cur.netRevenue,
        orders: cur.orders,
        avgOrder: cur.avgOrder,
        grossProfit: granted.includes("cost.view") ? cur.grossProfit : null,
        refundTotal: cur.refundTotal,
        discountTotal: cur.discountTotal,
      },
      series: buckets.map((bucket) => ({ bucket, ...byBucket.get(bucket)! })),
      generatedAt: new Date().toISOString(),
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      compare,
      compareLabel: label,
    };
  }

  async getProductsReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ): Promise<{
    rows: Array<{ productId: string; name: string; qty: number; revenue: number; profit: number | null; marginPct: number | null }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, compare, label } = this.resolved(query);
    const canSeeProfit = granted.includes("cost.view");
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const tab = query.tab ?? "top";
    const withLines = await this.linesFor(businessId, await this.settledSales(businessId, range, query.registerId));
    const agg = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
    for (const s of withLines) {
      for (const l of s.items) {
        const row = agg.get(l.productId) ?? { name: l.name, qty: 0, revenue: 0, profit: 0 };
        row.qty += l.qty;
        row.revenue += l.lineTotalMinor;
        row.profit += l.lineTotalMinor - l.costMinor * l.qty;
        agg.set(l.productId, row);
      }
    }
    // Refund cost relief per product.
    for (const s of withLines) {
      const refundItems = await this.db.listRefundItemsBySale(s.sale.id, businessId);
      const costByLine = new Map(s.items.map((l) => [l.id, l.costMinor]));
      for (const r of refundItems) {
        const row = agg.get(r.productId);
        if (row) row.profit -= (costByLine.get(r.saleItemId) ?? 0) * r.qty;
      }
    }
    const toRow = (productId: string, r: { name: string; qty: number; revenue: number; profit: number }) => ({
      productId,
      name: r.name,
      qty: r.qty,
      revenue: r.revenue,
      profit: canSeeProfit ? r.profit : null,
      marginPct: canSeeProfit && r.revenue > 0 ? Math.round((r.profit / r.revenue) * 100) : null,
    });
    let rows;
    if (tab === "top") {
      rows = [...agg.entries()]
        .map(([productId, r]) => toRow(productId, r))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit);
    } else {
      const products = await this.db.listProducts(businessId);
      const soldIds = new Set(agg.keys());
      if (tab === "slow") {
        rows = products
          .filter((p) => p.isActive && !soldIds.has(p.id))
          .map((p) => toRow(p.id, { name: p.name, qty: 0, revenue: 0, profit: 0 }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, limit);
      } else {
        const cutoff = range.to.getTime() - 90 * 24 * 3600 * 1000;
        const allSales = await this.db.listSalesByBusiness(businessId);
        const recentIds = new Set<string>();
        for (const s of allSales) {
          if (!isSettled(s.status) || s.createdAt.getTime() < cutoff) continue;
          for (const l of await this.db.listSaleItems(s.id, businessId)) recentIds.add(l.productId);
        }
        rows = products
          .filter((p) => !recentIds.has(p.id))
          .map((p) => toRow(p.id, { name: p.name, qty: 0, revenue: 0, profit: 0 }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, limit);
      }
    }
    return {
      rows,
      generatedAt: new Date().toISOString(),
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      compare,
      compareLabel: label,
    };
  }
}

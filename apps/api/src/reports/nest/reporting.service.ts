import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbPort, DbSale, DbSaleItem } from "../../common/db.port";
import { BillingService } from "../../billing/nest/billing.service";
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
import { sumCashComponents } from "../../shifts/cash";

export interface ReportQuery {
  dateFrom?: string;
  dateTo?: string;
  compare?: string;
  registerId?: string;
  // Phase 9a: optional branch scope; absent = all branches including null scope.
  branchId?: string;
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
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

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
    branchId?: string,
  ): Promise<DbSale[]> {
    const all = await this.db.listSalesByBusiness(businessId);
    return all.filter(
      (s) =>
        isSettled(s.status) &&
        this.inRange(s.createdAt, range) &&
        (!registerId || s.registerId === registerId) &&
        (!branchId || (s.branchId ?? null) === branchId),
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
    branchId?: string,
  ): Promise<{
    netRevenue: number;
    orders: number;
    avgOrder: number;
    grossProfit: number;
    refundTotal: number;
    discountTotal: number;
  }> {
    const sales = await this.settledSales(businessId, range, registerId, branchId);
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
    const cur = await this.metrics(businessId, range, query.registerId, query.branchId);
    const curExpenses = await this.expensesTotal(businessId, range);
    const old = prev ? await this.metrics(businessId, prev, query.registerId, query.branchId) : null;
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
    const sales = await this.settledSales(businessId, range, query.registerId, query.branchId);
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
    const attention = await this.attentionFor(businessId, query.branchId);
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
    branchId?: string,
  ): Promise<Array<{ kind: string; label: string; href: string; count: number }>> {
    const out: Array<{ kind: string; label: string; href: string; count: number }> = [];
    const products = await this.db.listProducts(businessId);
    let low = 0;
    let outCount = 0;
    for (const p of products) {
      if (!p.isActive) continue;
      const bal = branchId
        ? await this.db.findBalance(p.id, businessId, branchId)
        : await this.db.findBalance(p.id, businessId);
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
    await new BillingService(this.db).requireFeature(businessId, "reports");
    const cur = await this.metrics(businessId, range, query.registerId, query.branchId);
    const buckets = bucketRange(range.from, range.to, granularity);
    const byBucket = new Map<string, { netRevenue: number; orders: number }>();
    for (const b of buckets) byBucket.set(b, { netRevenue: 0, orders: 0 });
    const withLines = await this.linesFor(businessId, await this.settledSales(businessId, range, query.registerId, query.branchId));
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
    await new BillingService(this.db).requireFeature(businessId, "reports");
    const withLines = await this.linesFor(businessId, await this.settledSales(businessId, range, query.registerId, query.branchId));
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

  async getInventoryReport(businessId: string, branchId?: string): Promise<{
    healthy: number;
    low: number;
    out: number;
    untracked: number;
    lowStock: Array<{ productId: string; name: string; onHand: number; reorderLevel: number }>;
    movements: { received: number; sold: number; damaged: number; adjusted: number };
    generatedAt: string;
  }> {
    withScope(businessId, {});
    await new BillingService(this.db).requireFeature(businessId, "reports");
    const products = await this.db.listProducts(businessId);
    let healthy = 0;
    let low = 0;
    let out = 0;
    let untracked = 0;
    const lowStock: Array<{ productId: string; name: string; onHand: number; reorderLevel: number }> = [];
    for (const p of products) {
      if (!p.isActive) continue;
      // Phase 9a: when a branch filter is active, health counts derive from
      // that branch's balances; the movements section stays business-wide
      // (pre-9a rows are null-scoped, so filtering would undercount history).
      const bal = branchId
        ? await this.db.findBalance(p.id, businessId, branchId)
        : await this.db.findBalance(p.id, businessId);
      const onHand = bal?.qtyOnHand ?? 0;
      const status = deriveStockStatus({ qtyOnHand: onHand, reorderLevel: p.reorderLevel, trackInventory: p.trackInventory });
      if (status === "untracked") {
        untracked += 1;
        continue;
      }
      if (status === "ok") healthy += 1;
      if (status === "low") {
        low += 1;
        lowStock.push({ productId: p.id, name: p.name, onHand, reorderLevel: p.reorderLevel });
      }
      if (status === "out") {
        out += 1;
        lowStock.push({ productId: p.id, name: p.name, onHand, reorderLevel: p.reorderLevel });
      }
    }
    lowStock.sort((a, b) => a.name.localeCompare(b.name));
    // All-time ledger sums: DbMovement carries no timestamp, so no date
    // filtering is possible here. Documented, not a bug.
    const movements = await this.db.listMovementsByBusiness(businessId);
    let received = 0;
    let sold = 0;
    let damaged = 0;
    let adjusted = 0;
    for (const m of movements) {
      if (m.type === "opening_stock" || m.type === "receive" || m.type === "return" || m.type === "transfer_in") {
        received += m.qtyDelta;
      } else if (m.type === "sale" || m.type === "transfer_out") {
        sold += -m.qtyDelta;
      } else if (m.type === "damage") {
        damaged += -m.qtyDelta;
      } else if (m.type === "adjustment" || m.type === "stock_count") {
        adjusted += m.qtyDelta;
      }
    }
    return {
      healthy,
      low,
      out,
      untracked,
      lowStock: lowStock.slice(0, 50),
      movements: { received, sold, damaged, adjusted },
      generatedAt: new Date().toISOString(),
    };
  }

  async getPaymentsReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ): Promise<{
    byMethod: Array<{ method: string; total: number; count: number }>;
    unknown: number;
    refunded: number;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    void granted;
    await new BillingService(this.db).requireFeature(businessId, "reports");
    const { range, compare, label } = this.resolved(query);
    const sales = await this.settledSales(businessId, range, query.registerId);
    const byMethod = new Map<string, { total: number; count: number }>();
    let unknown = 0;
    let refunded = 0;
    for (const s of sales) {
      for (const p of await this.db.listPaymentsBySale(s.id, businessId)) {
        if (p.status === "SUCCEEDED") {
          const row = byMethod.get(p.method) ?? { total: 0, count: 0 };
          row.total += p.amountMinor;
          row.count += 1;
          byMethod.set(p.method, row);
        } else if (p.status === "UNKNOWN") {
          unknown += 1;
        } else if (p.status === "REFUNDED") {
          refunded += p.amountMinor;
        }
      }
    }
    return {
      byMethod: [...byMethod.entries()]
        .map(([method, r]) => ({ method, ...r }))
        .sort((a, b) => b.total - a.total),
      unknown,
      refunded,
      generatedAt: new Date().toISOString(),
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      compare,
      compareLabel: label,
    };
  }

  async getCashReport(
    businessId: string,
    query: ReportQuery,
  ): Promise<{
    shifts: Array<{
      shiftId: string;
      registerId: string;
      status: string;
      expectedCash: number;
      countedCash: number | null;
      variance: number | null;
    }>;
    generatedAt: string;
  }> {
    withScope(businessId, {});
    await new BillingService(this.db).requireFeature(businessId, "reports");
    // DbShift carries no timestamp fields, so no date filtering is applied;
    // date scoping arrives with a future openedAt column (no migration here).
    let shifts = await this.db.listShiftsByBusiness(businessId);
    if (query.registerId) shifts = shifts.filter((s) => s.registerId === query.registerId);
    if (query.branchId) shifts = shifts.filter((s) => (s.branchId ?? null) === query.branchId);
    shifts = [...shifts].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 100);
    const out: Array<{
      shiftId: string;
      registerId: string;
      status: string;
      expectedCash: number;
      countedCash: number | null;
      variance: number | null;
    }> = [];
    for (const s of shifts) {
      if (s.status === "CLOSED") {
        out.push({
          shiftId: s.id,
          registerId: s.registerId,
          status: s.status,
          expectedCash: s.expectedCashMinor,
          countedCash: s.countedCashMinor,
          variance: s.varianceMinor,
        });
      } else {
        const movements = await this.db.listCashMovementsByShift(s.id, businessId);
        const sums = sumCashComponents(movements);
        out.push({
          shiftId: s.id,
          registerId: s.registerId,
          status: s.status,
          expectedCash: s.openingFloatMinor + sums.cashSales - sums.cashRefunds - sums.cashExpenses + sums.cashDeposits - sums.cashWithdrawals + sums.adjustments,
          countedCash: null,
          variance: null,
        });
      }
    }
    return { shifts: out, generatedAt: new Date().toISOString() };
  }

  async getBranchesReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ): Promise<{
    rows: Array<{ branchId: string | null; name: string; type: string; sales: number; orders: number; margin: number | null }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, compare, label } = this.resolved(query);
    const canSeeProfit = granted.includes("cost.view");
    const branches = await this.db.listBranchesByBusiness(businessId);
    await new BillingService(this.db).requireFeature(businessId, "reports");
    const withLines = await this.linesFor(businessId, await this.settledSales(businessId, range));
    const groups = new Map<string | null, SaleWithLines[]>();
    for (const s of withLines) {
      const key = s.sale.branchId ?? null;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    const summarize = async (items: SaleWithLines[]) => ({
      sales: items.reduce((sum, s) => sum + s.sale.totalMinor - s.refunded, 0),
      orders: items.length,
      margin: canSeeProfit ? await this.profitOf(items, businessId) : null,
    });
    const rows: Array<{ branchId: string | null; name: string; type: string; sales: number; orders: number; margin: number | null }> = [];
    for (const b of branches) {
      const { sales, orders, margin } = await summarize(groups.get(b.id) ?? []);
      rows.push({ branchId: b.id, name: b.name, type: b.type, sales, orders, margin });
    }
    // Null-branch (legacy single-location) activity gets its own row so the
    // table reconciles with the unfiltered totals.
    const unscoped = groups.get(null) ?? [];
    if (unscoped.length > 0) {
      const { sales, orders, margin } = await summarize(unscoped);
      rows.push({ branchId: null, name: "Unscoped", type: "unscoped", sales, orders, margin });
    }
    rows.sort((a, b) => b.sales - a.sales);
    return {
      rows,
      generatedAt: new Date().toISOString(),
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      compare,
      compareLabel: label,
    };
  }

  async getCustomersReport(
    businessId: string,
    query: { dateFrom?: string; dateTo?: string; compare?: string },
    role: string,
  ): Promise<{
    total: number;
    active: number;
    top: Array<{ customerId: string; name: string; spend: number; orders: number }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, compare, label } = this.resolved(query);
    const customers = await this.db.listCustomersByBusiness(businessId);
    await new BillingService(this.db).requireFeature(businessId, "customers");
    const sales = await this.settledSales(businessId, range);
    const withLines = await this.linesFor(businessId, sales);
    const spend = new Map<string, { spend: number; orders: number }>();
    for (const s of withLines) {
      if (!s.sale.customerId) continue;
      const row = spend.get(s.sale.customerId) ?? { spend: 0, orders: 0 };
      row.spend += s.sale.totalMinor - s.refunded;
      row.orders += 1;
      spend.set(s.sale.customerId, row);
    }
    const top: Array<{ customerId: string; name: string; spend: number; orders: number }> = [];
    for (const [customerId, r] of spend) {
      const row = await this.db.findCustomerById(customerId, businessId);
      top.push({ customerId, name: row?.name ?? "Walk-in", ...r });
    }
    top.sort((a, b) => b.spend - a.spend);
    return {
      total: customers.length,
      active: customers.filter((c) => c.isActive).length,
      top: top.slice(0, 10),
      generatedAt: new Date().toISOString(),
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      compare,
      compareLabel: label,
    };
  }

  async getCashiersReport(
    businessId: string,
    query: ReportQuery,
    role: string,
  ): Promise<{
    actors: Array<{
      actorId: string;
      name: string;
      sales: number;
      orders: number;
      refunds: number;
      refundTotal: number;
      discounts: number;
      varianceContext: { shiftsClosed: number; totalVariance: number };
    }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    if (role !== "owner" && role !== "manager") throw new Error("FORBIDDEN");
    await new BillingService(this.db).requireFeature(businessId, "advanced_reports");
    const { range, compare, label } = this.resolved(query);
    const sales = await this.settledSales(businessId, range, query.registerId);
    const withLines = await this.linesFor(businessId, sales);
    const agg = new Map<string, { sales: number; orders: number; refunds: number; refundTotal: number; discounts: number }>();
    for (const s of withLines) {
      const row = agg.get(s.sale.actorId) ?? { sales: 0, orders: 0, refunds: 0, refundTotal: 0, discounts: 0 };
      row.sales += s.sale.totalMinor - s.refunded;
      row.orders += 1;
      row.discounts += s.sale.discountMinor;
      const refundRows = await this.db.listRefundsBySale(s.sale.id, businessId);
      row.refunds += refundRows.length;
      row.refundTotal += s.refunded;
      agg.set(s.sale.actorId, row);
    }
    const shifts = await this.db.listShiftsByBusiness(businessId);
    const actors = [];
    for (const [actorId, r] of agg) {
      const user = await this.db.findUserById(actorId);
      const closed = shifts.filter((s) => s.status === "CLOSED" && s.closedBy === actorId);
      actors.push({
        actorId,
        name: user?.name ?? actorId,
        ...r,
        varianceContext: {
          shiftsClosed: closed.length,
          totalVariance: closed.reduce((sum, s) => sum + (s.varianceMinor ?? 0), 0),
        },
      });
    }
    return {
      actors,
      generatedAt: new Date().toISOString(),
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      compare,
      compareLabel: label,
    };
  }
}

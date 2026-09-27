import type { DbPort, DbSale, DbSaleItem } from "../common/db.port";
import {
  compareLabel,
  delta,
  isSettled,
  previousRange,
  resolveRange,
  type DateRange,
} from "./aggregate";

export interface ReportQuery {
  dateFrom?: string;
  dateTo?: string;
  compare?: string;
  registerId?: string;
  branchId?: string;
  granularity?: "day" | "hour";
  tab?: string;
  limit?: number;
}

export interface Kpi {
  value: number | null;
  previous: number | null;
  deltaMinor: number | null;
  deltaPct: number | null;
}

export interface SeriesPoint {
  bucket: string;
  netRevenue: number;
  orders: number;
}

export interface SaleWithLines {
  sale: DbSale;
  items: DbSaleItem[];
  refunded: number;
  refundedCost: number;
}

export class ReportingCore {
  constructor(private readonly db: DbPort) {}

  resolved(query: ReportQuery): { range: DateRange; prev: DateRange | null; compare: string; label: string } {
    const compare = query.compare ?? "previous_period";
    const range = resolveRange(query.dateFrom, query.dateTo);
    return { range, prev: previousRange(range, compare), compare, label: compareLabel(range, compare) };
  }

  inRange(date: Date, range: DateRange): boolean {
    return date.getTime() >= range.from.getTime() && date.getTime() <= range.to.getTime();
  }

  async settledSales(
    businessId: string,
    range: DateRange,
    registerId?: string,
    branchId?: string,
  ): Promise<DbSale[]> {
    const all = await this.db.listSalesByBusiness(businessId);
    return all.filter(
      (sale) =>
        isSettled(sale.status) &&
        this.inRange(sale.createdAt, range) &&
        (!registerId || sale.registerId === registerId) &&
        (!branchId || (sale.branchId ?? null) === branchId),
    );
  }

  async linesFor(businessId: string, sales: DbSale[]): Promise<SaleWithLines[]> {
    const [allItems, allRefundItems, allRefunds] = await Promise.all([
      this.db.listSaleItemsByBusiness(businessId),
      this.db.listRefundItemsByBusiness(businessId),
      this.db.listRefundsByBusiness(businessId),
    ]);
    const itemsBySale = new Map<string, DbSaleItem[]>();
    const itemCost = new Map<string, number>();
    for (const item of allItems) {
      const list = itemsBySale.get(item.saleId) ?? [];
      list.push(item);
      itemsBySale.set(item.saleId, list);
      itemCost.set(item.id, item.costMinor);
    }
    const saleOfRefund = new Map(allRefunds.map((refund) => [refund.id, refund.saleId]));
    const refundedBySale = new Map<string, number>();
    const refundedCostBySale = new Map<string, number>();
    for (const item of allRefundItems) {
      const saleId = saleOfRefund.get(item.refundId);
      if (!saleId) continue;
      refundedBySale.set(saleId, (refundedBySale.get(saleId) ?? 0) + item.amountMinor);
      refundedCostBySale.set(
        saleId,
        (refundedCostBySale.get(saleId) ?? 0) + (itemCost.get(item.saleItemId) ?? 0) * item.qty,
      );
    }
    return sales.map((sale) => ({
      sale,
      items: itemsBySale.get(sale.id) ?? [],
      refunded: refundedBySale.get(sale.id) ?? 0,
      refundedCost: refundedCostBySale.get(sale.id) ?? 0,
    }));
  }

  kpi(value: number, previous: number | null): Kpi {
    if (previous === null) return { value, previous, deltaMinor: null, deltaPct: null };
    const change = delta(value, previous);
    return { value, previous, deltaMinor: change.deltaMinor, deltaPct: change.deltaPct };
  }

  kpiMaybe(value: number | null, previous: number | null): Kpi {
    if (value === null) return { value: null, previous: null, deltaMinor: null, deltaPct: null };
    return this.kpi(value, previous);
  }

  profitOf(lines: SaleWithLines[]): number {
    return lines.reduce((sum, sale) => {
      const lineProfit = sale.items.reduce(
        (subtotal, item) => subtotal + item.lineTotalMinor - item.costMinor * item.qty,
        0,
      );
      return sum + lineProfit - sale.refundedCost;
    }, 0);
  }

  metricsFromLines(lines: SaleWithLines[]): {
    netRevenue: number;
    orders: number;
    avgOrder: number;
    grossProfit: number;
    refundTotal: number;
    discountTotal: number;
  } {
    const gross = lines.reduce((sum, sale) => sum + sale.sale.totalMinor, 0);
    const refundTotal = lines.reduce((sum, sale) => sum + sale.refunded, 0);
    const netRevenue = gross - refundTotal;
    const orders = lines.length;
    return {
      netRevenue,
      orders,
      avgOrder: orders === 0 ? 0 : netRevenue / orders,
      grossProfit: this.profitOf(lines),
      refundTotal,
      discountTotal: lines.reduce((sum, sale) => sum + sale.sale.discountMinor, 0),
    };
  }

  async metrics(
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
    return this.metricsFromLines(withLines);
  }

  async expensesTotal(businessId: string, range: DateRange): Promise<number> {
    const all = await this.db.listExpensesByBusiness(businessId);
    return all
      .filter((expense) => expense.voidedAt === null && this.inRange(expense.expenseDate, range))
      .reduce((sum, expense) => sum + expense.amountMinor, 0);
  }
}

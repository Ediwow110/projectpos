import { withScope } from "@pos/database";

import { BillingService } from "../billing/nest/billing.service";
import type { DbPort } from "../common/db.port";
import { deriveStockStatus } from "../inventory/projection";
import { isSettled } from "./aggregate";
import {
  ReportingCore,
  type ReportQuery,
  type SaleWithLines,
} from "./reporting-core";

export class ReportingBreakdownService {
  private readonly billing: BillingService;
  private readonly core: ReportingCore;

  constructor(private readonly db: DbPort) {
    this.billing = new BillingService(db);
    this.core = new ReportingCore(db);
  }

  async getProductsReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ): Promise<{
    rows: Array<{
      productId: string;
      name: string;
      qty: number;
      revenue: number;
      profit: number | null;
      marginPct: number | null;
    }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, compare, label } = this.core.resolved(query);
    const canSeeProfit = granted.includes("cost.view");
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const tab = query.tab ?? "top";
    await this.billing.requireFeature(businessId, "reports");
    const withLines = await this.core.linesFor(
      businessId,
      await this.core.settledSales(
        businessId,
        range,
        query.registerId,
        query.branchId,
      ),
    );
    const agg = new Map<
      string,
      { name: string; qty: number; revenue: number; profit: number }
    >();
    for (const sale of withLines) {
      for (const line of sale.items) {
        const row = agg.get(line.productId) ?? {
          name: line.name,
          qty: 0,
          revenue: 0,
          profit: 0,
        };
        row.qty += line.qty;
        row.revenue += line.lineTotalMinor;
        row.profit += line.lineTotalMinor - line.costMinor * line.qty;
        agg.set(line.productId, row);
      }
    }
    for (const sale of withLines) {
      const refundItems = await this.db.listRefundItemsBySale(
        sale.sale.id,
        businessId,
      );
      const costByLine = new Map(
        sale.items.map((line) => [line.id, line.costMinor]),
      );
      for (const refund of refundItems) {
        const row = agg.get(refund.productId);
        if (row) {
          row.profit -=
            (costByLine.get(refund.saleItemId) ?? 0) * refund.qty;
        }
      }
    }
    const toRow = (
      productId: string,
      row: { name: string; qty: number; revenue: number; profit: number },
    ) => ({
      productId,
      name: row.name,
      qty: row.qty,
      revenue: row.revenue,
      profit: canSeeProfit ? row.profit : null,
      marginPct:
        canSeeProfit && row.revenue > 0
          ? Math.round((row.profit / row.revenue) * 100)
          : null,
    });
    let rows;
    if (tab === "top") {
      rows = [...agg.entries()]
        .map(([productId, row]) => toRow(productId, row))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit);
    } else {
      const products = await this.db.listProducts(businessId);
      const soldIds = new Set(agg.keys());
      if (tab === "slow") {
        rows = products
          .filter((product) => product.isActive && !soldIds.has(product.id))
          .map((product) =>
            toRow(product.id, {
              name: product.name,
              qty: 0,
              revenue: 0,
              profit: 0,
            }),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, limit);
      } else {
        const cutoff = range.to.getTime() - 90 * 24 * 3600 * 1000;
        const allSales = await this.db.listSalesByBusiness(businessId);
        const recentIds = new Set<string>();
        for (const sale of allSales) {
          if (
            !isSettled(sale.status) ||
            sale.createdAt.getTime() < cutoff
          ) {
            continue;
          }
          for (const line of await this.db.listSaleItems(
            sale.id,
            businessId,
          )) {
            recentIds.add(line.productId);
          }
        }
        rows = products
          .filter((product) => !recentIds.has(product.id))
          .map((product) =>
            toRow(product.id, {
              name: product.name,
              qty: 0,
              revenue: 0,
              profit: 0,
            }),
          )
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

  async getInventoryReport(
    businessId: string,
    branchId?: string,
  ): Promise<{
    healthy: number;
    low: number;
    out: number;
    untracked: number;
    lowStock: Array<{
      productId: string;
      name: string;
      onHand: number;
      reorderLevel: number;
    }>;
    movements: {
      received: number;
      sold: number;
      damaged: number;
      adjusted: number;
      supplierReturned: number;
    };
    generatedAt: string;
  }> {
    withScope(businessId, {});
    await this.billing.requireFeature(businessId, "reports");
    const products = await this.db.listProducts(businessId);
    let healthy = 0;
    let low = 0;
    let out = 0;
    let untracked = 0;
    const lowStock: Array<{
      productId: string;
      name: string;
      onHand: number;
      reorderLevel: number;
    }> = [];
    for (const product of products) {
      if (!product.isActive) continue;
      const balance = branchId
        ? await this.db.findBalance(product.id, businessId, branchId)
        : await this.db.findBalance(product.id, businessId);
      const onHand = balance?.qtyOnHand ?? 0;
      const status = deriveStockStatus({
        qtyOnHand: onHand,
        reorderLevel: product.reorderLevel,
        trackInventory: product.trackInventory,
      });
      if (status === "untracked") {
        untracked += 1;
        continue;
      }
      if (status === "ok") healthy += 1;
      if (status === "low") {
        low += 1;
        lowStock.push({
          productId: product.id,
          name: product.name,
          onHand,
          reorderLevel: product.reorderLevel,
        });
      }
      if (status === "out") {
        out += 1;
        lowStock.push({
          productId: product.id,
          name: product.name,
          onHand,
          reorderLevel: product.reorderLevel,
        });
      }
    }
    lowStock.sort((a, b) => a.name.localeCompare(b.name));
    const movements = await this.db.listMovementsByBusiness(businessId);
    let received = 0;
    let sold = 0;
    let damaged = 0;
    let adjusted = 0;
    let supplierReturned = 0;
    for (const movement of movements) {
      if (
        movement.type === "opening_stock" ||
        movement.type === "receive" ||
        movement.type === "return" ||
        movement.type === "transfer_in"
      ) {
        received += movement.qtyDelta;
      } else if (
        movement.type === "sale" ||
        movement.type === "transfer_out"
      ) {
        sold += -movement.qtyDelta;
      } else if (movement.type === "supplier_return") {
        supplierReturned += -movement.qtyDelta;
      } else if (movement.type === "damage") {
        damaged += -movement.qtyDelta;
      } else if (
        movement.type === "adjustment" ||
        movement.type === "stock_count"
      ) {
        adjusted += movement.qtyDelta;
      }
    }
    return {
      healthy,
      low,
      out,
      untracked,
      lowStock: lowStock.slice(0, 50),
      movements: { received, sold, damaged, adjusted, supplierReturned },
      generatedAt: new Date().toISOString(),
    };
  }

  async getBranchesReport(
    businessId: string,
    query: ReportQuery,
    role: string,
    granted: string[],
  ): Promise<{
    rows: Array<{
      branchId: string | null;
      name: string;
      type: string;
      sales: number;
      orders: number;
      margin: number | null;
    }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, compare, label } = this.core.resolved(query);
    const canSeeProfit = granted.includes("cost.view");
    const branches = await this.db.listBranchesByBusiness(businessId);
    await this.billing.requireFeature(businessId, "reports");
    const withLines = await this.core.linesFor(
      businessId,
      await this.core.settledSales(businessId, range),
    );
    const groups = new Map<string | null, SaleWithLines[]>();
    for (const sale of withLines) {
      const key = sale.sale.branchId ?? null;
      const rows = groups.get(key) ?? [];
      rows.push(sale);
      groups.set(key, rows);
    }
    const summarize = async (items: SaleWithLines[]) => ({
      sales: items.reduce(
        (sum, sale) => sum + sale.sale.totalMinor - sale.refunded,
        0,
      ),
      orders: items.length,
      margin: canSeeProfit ? this.core.profitOf(items) : null,
    });
    const rows: Array<{
      branchId: string | null;
      name: string;
      type: string;
      sales: number;
      orders: number;
      margin: number | null;
    }> = [];
    for (const branch of branches) {
      const summary = await summarize(groups.get(branch.id) ?? []);
      rows.push({
        branchId: branch.id,
        name: branch.name,
        type: branch.type,
        ...summary,
      });
    }
    const unscoped = groups.get(null) ?? [];
    if (unscoped.length > 0) {
      rows.push({
        branchId: null,
        name: "Unscoped",
        type: "unscoped",
        ...(await summarize(unscoped)),
      });
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
    top: Array<{
      customerId: string;
      name: string;
      spend: number;
      orders: number;
    }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    void role;
    const { range, compare, label } = this.core.resolved(query);
    const customers = await this.db.listCustomersByBusiness(businessId);
    await this.billing.requireFeature(businessId, "customers");
    const withLines = await this.core.linesFor(
      businessId,
      await this.core.settledSales(businessId, range),
    );
    const spend = new Map<string, { spend: number; orders: number }>();
    for (const sale of withLines) {
      if (!sale.sale.customerId) continue;
      const row = spend.get(sale.sale.customerId) ?? {
        spend: 0,
        orders: 0,
      };
      row.spend += sale.sale.totalMinor - sale.refunded;
      row.orders += 1;
      spend.set(sale.sale.customerId, row);
    }
    const top: Array<{
      customerId: string;
      name: string;
      spend: number;
      orders: number;
    }> = [];
    for (const [customerId, row] of spend) {
      const customer = await this.db.findCustomerById(
        customerId,
        businessId,
      );
      top.push({
        customerId,
        name: customer?.name ?? "Walk-in",
        ...row,
      });
    }
    top.sort((a, b) => b.spend - a.spend);
    return {
      total: customers.length,
      active: customers.filter((customer) => customer.isActive).length,
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
      varianceContext: {
        shiftsClosed: number;
        totalVariance: number;
      };
    }>;
    generatedAt: string;
    range: { from: string; to: string };
    compare: string;
    compareLabel: string;
  }> {
    withScope(businessId, {});
    if (role !== "owner" && role !== "manager") {
      throw new Error("FORBIDDEN");
    }
    await this.billing.requireFeature(businessId, "advanced_reports");
    const { range, compare, label } = this.core.resolved(query);
    const withLines = await this.core.linesFor(
      businessId,
      await this.core.settledSales(
        businessId,
        range,
        query.registerId,
      ),
    );
    const agg = new Map<
      string,
      {
        sales: number;
        orders: number;
        refunds: number;
        refundTotal: number;
        discounts: number;
      }
    >();
    for (const sale of withLines) {
      const row = agg.get(sale.sale.actorId) ?? {
        sales: 0,
        orders: 0,
        refunds: 0,
        refundTotal: 0,
        discounts: 0,
      };
      row.sales += sale.sale.totalMinor - sale.refunded;
      row.orders += 1;
      row.discounts += sale.sale.discountMinor;
      const refunds = await this.db.listRefundsBySale(
        sale.sale.id,
        businessId,
      );
      row.refunds += refunds.length;
      row.refundTotal += sale.refunded;
      agg.set(sale.sale.actorId, row);
    }
    const shifts = await this.db.listShiftsByBusiness(businessId);
    const actors = [];
    for (const [actorId, row] of agg) {
      const user = await this.db.findUserById(actorId);
      const closed = shifts.filter(
        (shift) =>
          shift.status === "CLOSED" && shift.closedBy === actorId,
      );
      actors.push({
        actorId,
        name: user?.name ?? actorId,
        ...row,
        varianceContext: {
          shiftsClosed: closed.length,
          totalVariance: closed.reduce(
            (sum, shift) => sum + (shift.varianceMinor ?? 0),
            0,
          ),
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

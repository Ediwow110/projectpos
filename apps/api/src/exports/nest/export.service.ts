import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";
import { isSettled } from "../../reports/aggregate";

// Account map [SPEC-DEFAULT]: 1000 Cash, 1400 Inventory, 4000 Revenue,
// 5000 COGS, 6000 Expenses. Inventory (1400) extends the four-account map
// from the spec because the COGS leg needs a credit account; unbalanced
// journals would be worse than a five-account map.
const ACCT = { cash: "1000", inventory: "1400", revenue: "4000", cogs: "5000", expenses: "6000" } as const;

export interface JournalRow {
  date: string;
  type: string;
  ref: string;
  account: string;
  debitMinor: number;
  creditMinor: number;
  memo: string;
}

export interface LedgerQuery {
  dateFrom?: string;
  dateTo?: string;
}

function parseBound(raw: string | undefined, now: Date): Date | null {
  if (raw === undefined) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("VALIDATION");
  void now;
  return d;
}

const PAGE = 500;

@Injectable()
export class ExportService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async buildLedger(
    businessId: string,
    actorId: string,
    requestId: string,
    query: LedgerQuery,
  ): Promise<{ headers: string[]; rows: Array<Array<string | number>>; count: number }> {
    withScope(businessId, {});
    const now = new Date();
    const from = parseBound(query.dateFrom, now);
    const to = parseBound(query.dateTo, now) ?? now;
    if (from && from.getTime() > to.getTime()) throw new Error("VALIDATION");
    const inRange = (d: Date): boolean =>
      (!from || d.getTime() >= from.getTime()) && d.getTime() <= to.getTime();

    const rows: JournalRow[] = [];
    const sales = await this.db.listSalesByBusiness(businessId);
    for (let i = 0; i < sales.length; i += PAGE) {
      for (const s of sales.slice(i, i + PAGE)) {
        if (!isSettled(s.status) || !inRange(s.createdAt)) continue;
        const iso = s.createdAt.toISOString();
        rows.push({ date: iso, type: "sale", ref: s.receiptNo, account: ACCT.cash, debitMinor: s.totalMinor, creditMinor: 0, memo: s.receiptNo });
        rows.push({ date: iso, type: "sale", ref: s.receiptNo, account: ACCT.revenue, debitMinor: 0, creditMinor: s.totalMinor, memo: s.receiptNo });
        const items = await this.db.listSaleItems(s.id, businessId);
        const cost = items.reduce((sum, l) => sum + l.costMinor * l.qty, 0);
        if (cost > 0) {
          rows.push({ date: iso, type: "cogs", ref: s.receiptNo, account: ACCT.cogs, debitMinor: cost, creditMinor: 0, memo: `COGS ${s.receiptNo}` });
          rows.push({ date: iso, type: "cogs", ref: s.receiptNo, account: ACCT.inventory, debitMinor: 0, creditMinor: cost, memo: `COGS ${s.receiptNo}` });
        }
      }
    }

    const expenses = await this.db.listExpensesByBusiness(businessId);
    for (let i = 0; i < expenses.length; i += PAGE) {
      for (const e of expenses.slice(i, i + PAGE)) {
        if (e.voidedAt !== null || !inRange(e.expenseDate)) continue;
        const iso = e.expenseDate.toISOString();
        const memo = e.description?.trim() ? e.description.trim() : e.category;
        rows.push({ date: iso, type: "expense", ref: e.id, account: ACCT.expenses, debitMinor: e.amountMinor, creditMinor: 0, memo });
        rows.push({ date: iso, type: "expense", ref: e.id, account: ACCT.cash, debitMinor: 0, creditMinor: e.amountMinor, memo });
      }
    }

    // Movements carry no timestamp, so they cannot be date-filtered and are
    // always included all-time with an empty date cell (same documented
    // limitation as the inventory report). Sale/return movements are skipped:
    // their value is already booked through sale COGS. Branch transfer
    // movements net to zero across locations and are skipped for the same
    // reason.
    const movements = await this.db.listMovementsByBusiness(businessId);
    for (let i = 0; i < movements.length; i += PAGE) {
      for (const m of movements.slice(i, i + PAGE)) {
        if (m.type === "sale" || m.type === "return" || m.type === "transfer_in" || m.type === "transfer_out") continue;
        const product = await this.db.findProductById(m.productId, businessId);
        if (!product) continue;
        const value = Math.abs(m.qtyDelta) * product.costMinor;
        if (value <= 0) continue;
        const memo = `${m.type} ${product.name}`;
        if (m.qtyDelta > 0) {
          rows.push({ date: "", type: "inventory", ref: m.id, account: ACCT.inventory, debitMinor: value, creditMinor: 0, memo });
          rows.push({ date: "", type: "inventory", ref: m.id, account: ACCT.cogs, debitMinor: 0, creditMinor: value, memo });
        } else {
          rows.push({ date: "", type: "inventory", ref: m.id, account: ACCT.cogs, debitMinor: value, creditMinor: 0, memo });
          rows.push({ date: "", type: "inventory", ref: m.id, account: ACCT.inventory, debitMinor: 0, creditMinor: value, memo });
        }
      }
    }

    await this.db.appendAudit({
      businessId,
      actorId,
      action: "export.ledger",
      entityType: "Business",
      entityId: `${rows.length}`,
      requestId,
    });
    return {
      headers: ["date", "type", "ref", "account", "debitMinor", "creditMinor", "memo"],
      rows: rows.map((r) => [r.date, r.type, r.ref, r.account, r.debitMinor, r.creditMinor, r.memo]),
      count: rows.length,
    };
  }
}

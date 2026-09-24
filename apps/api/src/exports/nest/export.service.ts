import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbExpense, DbMovement, DbPayment, DbPort, DbSale } from "../../common/db.port";
import { isSettled } from "../../reports/aggregate";

// Account map [SPEC-DEFAULT]: 1000 Cash, 1400 Inventory, 2100 Card/Bank
// Clearing, 2110 E-Wallet Clearing, 2120 Other Clearing, 2200 Change Payable,
// 4000 Revenue, 5000 COGS, 6000 Expenses, 7000 Inventory Receipts.
// Clearing accounts exist because card, bank, and wallet tenders are not cash:
// booking them to 1000 would overstate the cash balance. Change payable holds
// overpayments the cashier must return. Inventory receipts (not COGS) absorb
// the value of stock coming in; only stock leaving inventory hits COGS. Every
// journal below is balanced by construction.
const ACCT = {
  cash: "1000",
  inventory: "1400",
  cardClearing: "2100",
  walletClearing: "2110",
  otherClearing: "2120",
  changePayable: "2200",
  revenue: "4000",
  cogs: "5000",
  expenses: "6000",
  purchases: "7000",
} as const;

const PAYMENT_ACCOUNTS: Record<string, string> = {
  cash: ACCT.cash,
  card: ACCT.cardClearing,
  bank_transfer: ACCT.cardClearing,
  gcash: ACCT.walletClearing,
  maya: ACCT.walletClearing,
  other: ACCT.otherClearing,
};

export function accountForMethod(method: string): string {
  return PAYMENT_ACCOUNTS[method] ?? ACCT.otherClearing;
}

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

// Source tables are read in bounded pages (cursor by id) so an export never
// loads a whole table into memory; the controller writes each page out as it
// arrives.
export const LEDGER_PAGE = 500;

function csvCell(value: string | number): string {
  const s = String(value);
  // Neutralize spreadsheet formula injection: a memo or product name starting
  // with =, +, -, @, tab, or CR would otherwise execute when opened in Excel.
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function ledgerCsvLine(row: JournalRow): string {
  return [
    row.date, row.type, row.ref, row.account, row.debitMinor, row.creditMinor, row.memo,
  ].map(csvCell).join(",");
}

export const LEDGER_HEADERS = "date,type,ref,account,debitMinor,creditMinor,memo";

@Injectable()
export class ExportService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private async *salePages(businessId: string): AsyncGenerator<DbSale[]> {
    let after: string | null = null;
    for (;;) {
      const page = await this.db.listSalesPage(businessId, after, LEDGER_PAGE);
      if (page.length === 0) return;
      yield page;
      after = page[page.length - 1]!.id;
      if (page.length < LEDGER_PAGE) return;
    }
  }

  private async *expensePages(businessId: string): AsyncGenerator<DbExpense[]> {
    let after: string | null = null;
    for (;;) {
      const page = await this.db.listExpensesPage(businessId, after, LEDGER_PAGE);
      if (page.length === 0) return;
      yield page;
      after = page[page.length - 1]!.id;
      if (page.length < LEDGER_PAGE) return;
    }
  }

  private async *movementPages(businessId: string): AsyncGenerator<DbMovement[]> {
    let after: string | null = null;
    for (;;) {
      const page = await this.db.listMovementsPage(businessId, after, LEDGER_PAGE);
      if (page.length === 0) return;
      yield page;
      after = page[page.length - 1]!.id;
      if (page.length < LEDGER_PAGE) return;
    }
  }

  // Largest-remainder split so a refund's credit lands on exactly the same
  // tender accounts the sale was debited to, with no lost minor units.
  private allocate(amountMinor: number, legs: Array<{ account: string; amountMinor: number }>): Array<{ account: string; amountMinor: number }> {
    const total = legs.reduce((s, l) => s + l.amountMinor, 0);
    if (total <= 0) return [];
    const exact = legs.map((l) => ({ account: l.account, exact: (amountMinor * l.amountMinor) / total }));
    const floors = exact.map((e) => ({ ...e, minor: Math.floor(e.exact) }));
    let remainder = amountMinor - floors.reduce((s, f) => s + f.minor, 0);
    const byFraction = [...floors].sort((a, b) => (b.exact - b.minor) - (a.exact - a.minor));
    for (const f of byFraction) {
      if (remainder <= 0) break;
      f.minor += 1;
      remainder -= 1;
    }
    return floors.filter((f) => f.minor > 0).map((f) => ({ account: f.account, amountMinor: f.minor }));
  }

  private async saleRows(businessId: string, sale: DbSale, inRange: (d: Date) => boolean): Promise<JournalRow[]> {
    if (!isSettled(sale.status) || !inRange(sale.createdAt)) return [];
    const iso = sale.createdAt.toISOString();
    const rows: JournalRow[] = [];
    const payments = (await this.db.listPaymentsBySale(sale.id, businessId)).filter(
      (p: DbPayment) => p.status === "SUCCEEDED" && p.amountMinor > 0,
    );
    // Debit the tender accounts actually used; fall back to cash only when a
    // settled sale has no payment rows (legacy data), never to invent revenue.
    const legs = payments.length > 0
      ? payments.map((p) => ({ account: accountForMethod(p.method), amountMinor: p.amountMinor }))
      : [{ account: ACCT.cash, amountMinor: sale.totalMinor }];
    for (const leg of legs) {
      rows.push({ date: iso, type: "sale", ref: sale.receiptNo, account: leg.account, debitMinor: leg.amountMinor, creditMinor: 0, memo: sale.receiptNo });
    }
    rows.push({ date: iso, type: "sale", ref: sale.receiptNo, account: ACCT.revenue, debitMinor: 0, creditMinor: sale.totalMinor, memo: sale.receiptNo });
    // Cash handed back as change is a liability, not revenue: without this the
    // tender debits would not balance against the sale total.
    if (sale.changeMinor > 0) {
      rows.push({
        date: iso, type: "sale", ref: sale.receiptNo, account: ACCT.changePayable,
        debitMinor: 0, creditMinor: sale.changeMinor, memo: `Change ${sale.receiptNo}`,
      });
    }

    const items = await this.db.listSaleItems(sale.id, businessId);
    const cost = items.reduce((sum, l) => sum + l.costMinor * l.qty, 0);
    if (cost > 0) {
      rows.push({ date: iso, type: "cogs", ref: sale.receiptNo, account: ACCT.cogs, debitMinor: cost, creditMinor: 0, memo: `COGS ${sale.receiptNo}` });
      rows.push({ date: iso, type: "cogs", ref: sale.receiptNo, account: ACCT.inventory, debitMinor: 0, creditMinor: cost, memo: `COGS ${sale.receiptNo}` });
    }

    // Refunds are compensating records, never deletions: reverse the revenue
    // share, credit the original tender accounts, and return restocked goods
    // to inventory at cost. Refund records carry no timestamp, so the entries
    // post on the sale's date (same documented limitation as movements).
    const refunds = (await this.db.listRefundsBySale(sale.id, businessId)).filter(
      (r) => r.status === "APPROVED",
    );
    for (const refund of refunds) {
      if (refund.totalMinor <= 0) continue;
      rows.push({ date: iso, type: "refund", ref: refund.id, account: ACCT.revenue, debitMinor: refund.totalMinor, creditMinor: 0, memo: `Refund ${refund.id}` });
      for (const leg of this.allocate(refund.totalMinor, legs)) {
        rows.push({ date: iso, type: "refund", ref: refund.id, account: leg.account, debitMinor: 0, creditMinor: leg.amountMinor, memo: `Refund ${refund.id}` });
      }
      const refundItems = await this.db.listRefundItems(refund.id, businessId);
      let restockCost = 0;
      for (const item of refundItems) {
        if (!item.restocked || item.qty <= 0) continue;
        const product = await this.db.findProductById(item.productId, businessId);
        if (!product) continue;
        restockCost += product.costMinor * item.qty;
      }
      if (restockCost > 0) {
        rows.push({ date: iso, type: "refund", ref: refund.id, account: ACCT.inventory, debitMinor: restockCost, creditMinor: 0, memo: `Restock ${refund.id}` });
        rows.push({ date: iso, type: "refund", ref: refund.id, account: ACCT.cogs, debitMinor: 0, creditMinor: restockCost, memo: `Restock ${refund.id}` });
      }
    }
    return rows;
  }

  async *streamJournalRows(
    businessId: string,
    actorId: string,
    requestId: string,
    query: LedgerQuery,
  ): AsyncGenerator<JournalRow[]> {
    const now = new Date();
    const from = parseBound(query.dateFrom, now);
    const to = parseBound(query.dateTo, now) ?? now;
    if (from && from.getTime() > to.getTime()) throw new Error("VALIDATION");
    const inRange = (d: Date): boolean =>
      (!from || d.getTime() >= from.getTime()) && d.getTime() <= to.getTime();
    let emitted = 0;

    for await (const page of this.salePages(businessId)) {
      const rows: JournalRow[] = [];
      for (const sale of page) rows.push(...(await this.saleRows(businessId, sale, inRange)));
      if (rows.length > 0) {
        emitted += rows.length;
        yield rows;
      }
    }

    for await (const page of this.expensePages(businessId)) {
      const rows: JournalRow[] = [];
      for (const e of page) {
        if (e.voidedAt !== null || !inRange(e.expenseDate)) continue;
        const iso = e.expenseDate.toISOString();
        const memo = e.description?.trim() ? e.description.trim() : e.category;
        const credit = accountForMethod(e.method);
        rows.push({ date: iso, type: "expense", ref: e.id, account: ACCT.expenses, debitMinor: e.amountMinor, creditMinor: 0, memo });
        rows.push({ date: iso, type: "expense", ref: e.id, account: credit, debitMinor: 0, creditMinor: e.amountMinor, memo });
      }
      if (rows.length > 0) {
        emitted += rows.length;
        yield rows;
      }
    }

    // Movements carry no timestamp, so they cannot be date-filtered and are
    // always included all-time with an empty date cell (same documented
    // limitation as the inventory report). Sale/return movements are skipped:
    // their value is already booked through sale COGS and refund restock.
    // Branch transfer movements net to zero across locations and are skipped
    // for the same reason.
    for await (const page of this.movementPages(businessId)) {
      const rows: JournalRow[] = [];
      for (const m of page) {
        if (m.type === "sale" || m.type === "return" || m.type === "transfer_in" || m.type === "transfer_out") continue;
        const product = await this.db.findProductById(m.productId, businessId);
        if (!product) continue;
        const value = Math.abs(m.qtyDelta) * product.costMinor;
        if (value <= 0) continue;
        const memo = `${m.type} ${product.name}`;
        if (m.qtyDelta > 0) {
          // Stock received: inventory up, purchases up. Never COGS.
          rows.push({ date: "", type: "inventory", ref: m.id, account: ACCT.inventory, debitMinor: value, creditMinor: 0, memo });
          rows.push({ date: "", type: "inventory", ref: m.id, account: ACCT.purchases, debitMinor: 0, creditMinor: value, memo });
        } else {
          // Damage, shrinkage, or an unexplained outbound adjustment is COGS.
          rows.push({ date: "", type: "inventory", ref: m.id, account: ACCT.cogs, debitMinor: value, creditMinor: 0, memo });
          rows.push({ date: "", type: "inventory", ref: m.id, account: ACCT.inventory, debitMinor: 0, creditMinor: value, memo });
        }
      }
      if (rows.length > 0) {
        emitted += rows.length;
        yield rows;
      }
    }

    await this.db.appendAudit({
      businessId,
      actorId,
      action: "export.ledger",
      entityType: "Business",
      entityId: `${emitted}`,
      requestId,
    });
  }

  async buildLedger(
    businessId: string,
    actorId: string,
    requestId: string,
    query: LedgerQuery,
  ): Promise<{ headers: string[]; rows: Array<Array<string | number>>; count: number }> {
    withScope(businessId, {});
    const rows: JournalRow[] = [];
    for await (const page of this.streamJournalRows(businessId, actorId, requestId, query)) {
      rows.push(...page);
    }
    return {
      headers: ["date", "type", "ref", "account", "debitMinor", "creditMinor", "memo"],
      rows: rows.map((r) => [r.date, r.type, r.ref, r.account, r.debitMinor, r.creditMinor, r.memo]),
      count: rows.length,
    };
  }
}

import type { DbCustomer, DbExchange, DbExpense, DbRefund, DbRefundCreate, DbRefundItem } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The people family: customers, refunds + refund items, and expenses.
// Mapping notes:
// - Runtime columns are exactly migrations 0007/0009's DDL. Customer carries
//   createdAt/updatedAt (stamped like every family's writes); Refund carries
//   createdAt; RefundItem and Expense carry no timestamps at all.
// - Tables without createdAt (RefundItem, Expense) order by "id" ASC — the same
//   precedent as SaleItem/InventoryBalance — while timestamped tables replicate
//   the memory Map's insertion order via "createdAt" ASC, "id" ASC.
// - updateCustomer/updateExpense build the SET clause from the patch's provided
//   keys only (undefined skipped, explicit nulls applied — the void flow patches
//   "voidedAt"/"voidReason" back to null). updateExpense stamps nothing: the
//   Expense DDL has no updatedAt column.
const CUSTOMER_COLUMNS = '"id", "businessId", "name", "phone", "email", "address", "notes", "isActive"';
const REFUND_COLUMNS =
  '"id", "businessId", "saleId", "status", "totalMinor", "deliveryFeeRefundMinor", "deliveryTaxRefundMinor", "reason", "requestedBy", ' +
  '"approvedBy", "requestId", "approvedRequestId", "singleStep", "createdAt"';
const REFUND_ITEM_COLUMNS =
  '"id", "businessId", "refundId", "saleItemId", "productId", "qty", "amountMinor", "restocked"';
const EXCHANGE_COLUMNS =
  '"id", "businessId", "originalSaleId", "refundId", "replacementSaleId", "returnMinor", "replacementMinor", ' +
  '"netMinor", "direction", "reason", "actorId", "requestId", "createdAt"';
const EXPENSE_COLUMNS =
  '"id", "businessId", "category", "amountMinor", "description", "method", "shiftId", "branchId", ' +
  '"expenseDate", "actorId", "requestId", "attachmentUrl", "voidedAt", "voidReason", "cashAdjusted"';

// Column names come from the typed patch keys (never user input), so quoting
// them is safe. Keys explicitly set to undefined are skipped — the SQL NOT NULL
// columns could not take them, and no caller produces them.
function buildSet(patch: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`"${key}" = $${values.length}`);
  }
  return { sets, values };
}

export function peopleFamily(ctx: PgContext) {
  return {
    async createCustomer(c: Omit<DbCustomer, "id">): Promise<DbCustomer> {
      const cl = await ctx.client();
      try {
        const row = { ...c, id: nid("cust") };
        await cl.query(
          'INSERT INTO "Customer" ("id", "businessId", "name", "phone", "email", "address", "notes", "isActive", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [row.id, row.businessId, row.name, row.phone, row.email, row.address, row.notes, row.isActive],
        );
        return row;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async listCustomersByBusiness(businessId: string): Promise<DbCustomer[]> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${CUSTOMER_COLUMNS} FROM "Customer" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbCustomer[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async findCustomerById(id: string, businessId: string): Promise<DbCustomer | null> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${CUSTOMER_COLUMNS} FROM "Customer" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbCustomer | undefined) ?? null;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async updateCustomer(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbCustomer, "id" | "businessId">>,
    ): Promise<DbCustomer | null> {
      const cl = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await cl.query(
          `UPDATE "Customer" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${CUSTOMER_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbCustomer | undefined) ?? null;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async createRefund(r: DbRefundCreate): Promise<DbRefund> {
      const cl = await ctx.client();
      try {
        const createdAt = new Date();
        const row: DbRefund = {
          deliveryFeeRefundMinor: 0,
          deliveryTaxRefundMinor: 0,
          ...r,
          id: nid("ref"),
          createdAt,
        };
        await cl.query(
          'INSERT INTO "Refund" ("id", "businessId", "saleId", "status", "totalMinor", "deliveryFeeRefundMinor", "deliveryTaxRefundMinor", "reason", "requestedBy", "approvedBy", "requestId", "approvedRequestId", "singleStep", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
          [
            row.id, row.businessId, row.saleId, row.status, row.totalMinor, row.deliveryFeeRefundMinor, row.deliveryTaxRefundMinor, row.reason,
            row.requestedBy, row.approvedBy, row.requestId, row.approvedRequestId, row.singleStep, row.createdAt,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async listRefundsByBusiness(businessId: string): Promise<DbRefund[]> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${REFUND_COLUMNS} FROM "Refund" WHERE "businessId" = $1 ORDER BY "id" ASC`,
          [businessId],
        );
        return r.rows as DbRefund[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },
    async listRefundsPage(businessId: string, afterId: string | null, limit: number): Promise<DbRefund[]> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${REFUND_COLUMNS} FROM "Refund" WHERE "businessId"=$1 AND ($2::text IS NULL OR "id">$2) ORDER BY "id" ASC LIMIT $3`,
          [businessId, afterId, Math.max(1, Math.min(500, limit))],
        );
        return r.rows as DbRefund[];
      } finally { if (ctx.owns()) cl.release(); }
    },
    async listRefundsBySale(saleId: string, businessId: string): Promise<DbRefund[]> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${REFUND_COLUMNS} FROM "Refund" WHERE "saleId" = $1 AND "businessId" = $2` +
            ' ORDER BY "createdAt" ASC, "id" ASC',
          [saleId, businessId],
        );
        return r.rows as DbRefund[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async findRefundById(id: string, businessId: string): Promise<DbRefund | null> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${REFUND_COLUMNS} FROM "Refund" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbRefund | undefined) ?? null;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async createRefundItem(i: Omit<DbRefundItem, "id">): Promise<DbRefundItem> {
      const cl = await ctx.client();
      try {
        const row = { ...i, id: nid("ritem") };
        await cl.query(
          'INSERT INTO "RefundItem" ("id", "businessId", "refundId", "saleItemId", "productId", "qty", "amountMinor", "restocked")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [row.id, row.businessId, row.refundId, row.saleItemId, row.productId, row.qty, row.amountMinor, row.restocked],
        );
        return row;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async listRefundItems(refundId: string, businessId: string): Promise<DbRefundItem[]> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${REFUND_ITEM_COLUMNS} FROM "RefundItem" WHERE "refundId" = $1 AND "businessId" = $2 ORDER BY "id" ASC`,
          [refundId, businessId],
        );
        return r.rows as DbRefundItem[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async listRefundItemsBySale(saleId: string, businessId: string): Promise<DbRefundItem[]> {
      const cl = await ctx.client();
      try {
        // Memory: collect the sale's refund ids (tenant-scoped), then keep this
        // tenant's items whose refund is one of them.
        const r = await cl.query(
          `SELECT ${REFUND_ITEM_COLUMNS} FROM "RefundItem" WHERE "businessId" = $2 AND` +
            ' "refundId" IN (SELECT "id" FROM "Refund" WHERE "saleId" = $1 AND "businessId" = $2)' +
            ' ORDER BY "id" ASC',
          [saleId, businessId],
        );
        return r.rows as DbRefundItem[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },
    async listRefundItemsByBusiness(businessId: string): Promise<DbRefundItem[]> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${REFUND_ITEM_COLUMNS} FROM "RefundItem" WHERE "businessId" = $1 ORDER BY "id" ASC`,
          [businessId],
        );
        return r.rows as DbRefundItem[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async createExchange(e: Omit<DbExchange, "id" | "createdAt">): Promise<DbExchange> {
      const cl = await ctx.client();
      try {
        const row: DbExchange = { ...e, id: nid("exch"), createdAt: new Date() };
        await cl.query(
          'INSERT INTO "Exchange" ("id", "businessId", "originalSaleId", "refundId", "replacementSaleId", "returnMinor", "replacementMinor", "netMinor", "direction", "reason", "actorId", "requestId", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
          [row.id, row.businessId, row.originalSaleId, row.refundId, row.replacementSaleId, row.returnMinor, row.replacementMinor, row.netMinor, row.direction, row.reason, row.actorId, row.requestId, row.createdAt],
        );
        return row;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async findExchangeById(id: string, businessId: string): Promise<DbExchange | null> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${EXCHANGE_COLUMNS} FROM "Exchange" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbExchange | undefined) ?? null;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async listExchangesByOriginalSale(originalSaleId: string, businessId: string): Promise<DbExchange[]> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${EXCHANGE_COLUMNS} FROM "Exchange" WHERE "originalSaleId" = $1 AND "businessId" = $2 ORDER BY "createdAt" ASC, "id" ASC`,
          [originalSaleId, businessId],
        );
        return r.rows as DbExchange[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async findExchangeByReplacementSale(replacementSaleId: string, businessId: string): Promise<DbExchange | null> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${EXCHANGE_COLUMNS} FROM "Exchange" WHERE "replacementSaleId" = $1 AND "businessId" = $2 ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`,
          [replacementSaleId, businessId],
        );
        return (r.rows[0] as DbExchange | undefined) ?? null;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async createExpense(e: Omit<DbExpense, "id">): Promise<DbExpense> {
      const cl = await ctx.client();
      try {
        const row = { ...e, id: nid("exp") };
        await cl.query(
          'INSERT INTO "Expense" ("id", "businessId", "category", "amountMinor", "description", "method", "shiftId", "branchId", "expenseDate", "actorId", "requestId", "attachmentUrl", "voidedAt", "voidReason", "cashAdjusted")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
          [
            row.id, row.businessId, row.category, row.amountMinor, row.description ?? null,
            row.method, row.shiftId ?? null, row.branchId ?? null, row.expenseDate, row.actorId,
            row.requestId, row.attachmentUrl ?? null, row.voidedAt, row.voidReason, row.cashAdjusted,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async listExpensesByBusiness(businessId: string): Promise<DbExpense[]> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${EXPENSE_COLUMNS} FROM "Expense" WHERE "businessId" = $1 ORDER BY "id" ASC`,
          [businessId],
        );
        return r.rows as DbExpense[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async listExpensesPage(businessId: string, afterId: string | null, limit: number): Promise<DbExpense[]> {
      const cl = await ctx.client();
      try {
        // Memory: filter businessId, keep `afterId === null || id > afterId`,
        // sort ascending by id (text compare), take limit.
        const r = await cl.query(
          `SELECT ${EXPENSE_COLUMNS} FROM "Expense" WHERE "businessId" = $1 AND ($2::text IS NULL OR "id" > $2)` +
            ' ORDER BY "id" ASC LIMIT $3',
          [businessId, afterId, limit],
        );
        return r.rows as DbExpense[];
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async findExpenseById(id: string, businessId: string): Promise<DbExpense | null> {
      const cl = await ctx.client();
      try {
        const r = await cl.query(
          `SELECT ${EXPENSE_COLUMNS} FROM "Expense" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbExpense | undefined) ?? null;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },

    async updateExpense(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbExpense, "id" | "businessId">>,
    ): Promise<DbExpense | null> {
      const cl = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        // No updatedAt column to stamp, so an empty patch would be invalid SQL;
        // memory treats it as a plain read, so do exactly that.
        if (sets.length === 0) {
          const r = await cl.query(
            `SELECT ${EXPENSE_COLUMNS} FROM "Expense" WHERE "id" = $1 AND "businessId" = $2`,
            [id, businessId],
          );
          return (r.rows[0] as DbExpense | undefined) ?? null;
        }
        const r = await cl.query(
          `UPDATE "Expense" SET ${sets.join(", ")}` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${EXPENSE_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbExpense | undefined) ?? null;
      } finally {
        if (ctx.owns()) cl.release();
      }
    },
  };
}

export type PeopleFamily = ReturnType<typeof peopleFamily>;

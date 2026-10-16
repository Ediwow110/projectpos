import type { DbPayment, DbSale, DbSaleCreate, DbSaleItem, DbHeldSale, DbIdempotency } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The sales family: sales, sale items, payments, held sales and the
// idempotency ledger. Mapping notes:
// - "Sale"."updatedAt" is NOT NULL without a DDL default, so every write sets
//   it explicitly; it is never exposed (memory rows carry no timestamps).
// - createSale keeps the caller-provided createdAt/completedAt exactly like the
//   memory store does; completedAt defaults to null on a draft.
// - SaleItem.position is the durable cashier/cart line order. Generated ids
//   are identifiers only and must never be used as an ordering proxy.
// - claimIdempotency mirrors the memory store byte-for-byte: the first claim
//   for (businessId, key, commandType) stores the row, any later claim throws
//   "IDEMPOTENCY_REPLAY". The arbiter is the unique index
//   SaleIdempotency_businessId_key_commandType_key (migration 0005); INSERT ..
//   ON CONFLICT DO NOTHING makes the race atomic, so concurrent callers can
//   never both win — the loser's INSERT is ignored and it throws.
const SALE_SELECT =
  '"id", "businessId", "receiptNo", "status", "subtotalMinor", "discountMinor", "taxMinor", "deliveryFeeMinor", "deliveryTaxMinor", "totalMinor", ' +
  '"paidMinor", "changeMinor", "currency", "customerId", "customerName", "notes", "actorId", "requestId", ' +
  '"idempotencyKey", "registerId", "branchId", "completedAt", "voidedAt", "voidReason", "createdAt"';
const ITEM_SELECT =
  '"id", "businessId", "saleId", "position", "productId", "name", "unit", "qty", "priceMinor", "costMinor", ' +
  '"taxRateBps", "lineDiscountMinor", "lineTotalMinor"';
const PAYMENT_SELECT = '"id", "businessId", "saleId", "method", "amountMinor", "status", "providerRef", "internalInstrumentType", "internalInstrumentId", "idempotencyKey"';

function normalizePayment(row: DbPayment): DbPayment {
  const { internalInstrumentType, internalInstrumentId, ...base } = row;
  return {
    ...base,
    ...(internalInstrumentType ? { internalInstrumentType } : {}),
    ...(internalInstrumentId ? { internalInstrumentId } : {}),
  };
}
const HELD_SELECT = '"id", "businessId", "actorId", "payload", "resumedAt"';
const IDEMPOTENCY_SELECT = '"businessId", "key", "commandType", "fingerprint", "resultId"';

// Column names come from the typed patch keys (never user input), so quoting
// them is safe. Keys explicitly set to undefined are skipped — the SQL NOT NULL
// columns could not take them, and no caller produces them. Explicit nulls are
// kept: the services null columns (branchId, customerId, completedAt).
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

export function salesFamily(ctx: PgContext) {
  return {
    async createSale(s: DbSaleCreate): Promise<DbSale> {
      const c = await ctx.client();
      try {
        // Memory: { completedAt: null, ...s, id } — the caller's completion
        // stamp wins, drafts stay null.
        const row: DbSale = {
          completedAt: null,
          voidedAt: null,
          voidReason: null,
          deliveryFeeMinor: 0,
          deliveryTaxMinor: 0,
          ...s,
          id: nid("sale"),
        };
        await c.query(
          'INSERT INTO "Sale" ("id", "businessId", "receiptNo", "status", "subtotalMinor", "discountMinor", "taxMinor", "deliveryFeeMinor", "deliveryTaxMinor", "totalMinor", "paidMinor", "changeMinor", "currency", "customerId", "customerName", "notes", "actorId", "requestId", "idempotencyKey", "registerId", "branchId", "completedAt", "voidedAt", "voidReason", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.receiptNo, row.status, row.subtotalMinor, row.discountMinor,
            row.taxMinor, row.deliveryFeeMinor, row.deliveryTaxMinor, row.totalMinor, row.paidMinor, row.changeMinor, row.currency,
            row.customerId ?? null, row.customerName ?? null, row.notes ?? null, row.actorId,
            row.requestId, row.idempotencyKey ?? null, row.registerId ?? null, row.branchId ?? null,
            row.completedAt ?? null, row.voidedAt ?? null, row.voidReason ?? null, row.createdAt,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findSaleById(id: string, businessId: string): Promise<DbSale | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${SALE_SELECT} FROM "Sale" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbSale | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findSaleByReceiptNo(receiptNo: string, businessId: string): Promise<DbSale | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${SALE_SELECT} FROM "Sale" WHERE "receiptNo" = $1 AND "businessId" = $2 LIMIT 1`,
          [receiptNo, businessId],
        );
        return (r.rows[0] as DbSale | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listSalesByBusiness(businessId: string): Promise<DbSale[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${SALE_SELECT} FROM "Sale" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbSale[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async countSalesByBusiness(businessId: string): Promise<number> {
      const c = await ctx.client();
      try {
        const r = await c.query<{ count: string }>(
          'SELECT COUNT(*)::text AS "count" FROM "Sale" WHERE "businessId" = $1',
          [businessId],
        );
        return Number(r.rows[0]?.count ?? 0);
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listSalesPage(businessId: string, afterId: string | null, limit: number): Promise<DbSale[]> {
      const c = await ctx.client();
      try {
        // Memory: filter businessId, keep `afterId === null || id > afterId`,
        // sort ascending by id (text compare), take limit — the audit view's
        // cursor, shared with listMovementsPage.
        const r = await c.query(
          `SELECT ${SALE_SELECT} FROM "Sale" WHERE "businessId" = $1 AND ($2::text IS NULL OR "id" > $2)` +
            ' ORDER BY "id" ASC LIMIT $3',
          [businessId, afterId, limit],
        );
        return r.rows as DbSale[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateSale(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbSale, "id" | "businessId">>,
    ): Promise<DbSale | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "Sale" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${SALE_SELECT}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbSale | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createSaleItem(
      i: Omit<DbSaleItem, "id" | "position"> & { position?: number },
    ): Promise<DbSaleItem> {
      const c = await ctx.client();
      try {
        let position = i.position;
        if (position === undefined) {
          const fallback = await c.query(
            'SELECT COALESCE(MAX("position"), -1) + 1 AS "position" FROM "SaleItem" WHERE "businessId" = $1 AND "saleId" = $2',
            [i.businessId, i.saleId],
          );
          position = Number(fallback.rows[0]?.position ?? 0);
        }
        const row = { ...i, position, id: nid("sitem") };
        await c.query(
          'INSERT INTO "SaleItem" ("id", "businessId", "saleId", "position", "productId", "name", "unit", "qty", "priceMinor", "costMinor", "taxRateBps", "lineDiscountMinor", "lineTotalMinor")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
          [
            row.id, row.businessId, row.saleId, row.position, row.productId, row.name, row.unit,
            row.qty, row.priceMinor, row.costMinor, row.taxRateBps ?? null,
            row.lineDiscountMinor, row.lineTotalMinor,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listSaleItems(saleId: string, businessId: string): Promise<DbSaleItem[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${ITEM_SELECT} FROM "SaleItem" WHERE "saleId" = $1 AND "businessId" = $2 ORDER BY "position" ASC, "id" ASC`,
          [saleId, businessId],
        );
        return r.rows as DbSaleItem[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },
    async listSaleItemsByBusiness(businessId: string): Promise<DbSaleItem[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${ITEM_SELECT} FROM "SaleItem" WHERE "businessId" = $1 ORDER BY "id" ASC`,
          [businessId],
        );
        return r.rows as DbSaleItem[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createPayment(p: Omit<DbPayment, "id">): Promise<DbPayment> {
      const c = await ctx.client();
      try {
        const row = { ...p, id: nid("pay") };
        await c.query(
          'INSERT INTO "Payment" ("id", "businessId", "saleId", "method", "amountMinor", "status", "providerRef", "internalInstrumentType", "internalInstrumentId", "idempotencyKey", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.saleId, row.method, row.amountMinor, row.status,
            row.providerRef ?? null, row.internalInstrumentType ?? null, row.internalInstrumentId ?? null, row.idempotencyKey,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findPaymentById(id: string, businessId: string): Promise<DbPayment | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PAYMENT_SELECT} FROM "Payment" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return r.rows[0] ? normalizePayment(r.rows[0] as DbPayment) : null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listPaymentsBySale(saleId: string, businessId: string): Promise<DbPayment[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PAYMENT_SELECT} FROM "Payment" WHERE "saleId" = $1 AND "businessId" = $2 ORDER BY "createdAt" ASC, "id" ASC`,
          [saleId, businessId],
        );
        return (r.rows as DbPayment[]).map(normalizePayment);
      } finally {
        if (ctx.owns()) c.release();
      }
    },
    async listPaymentsByBusiness(businessId: string): Promise<DbPayment[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PAYMENT_SELECT} FROM "Payment" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return (r.rows as DbPayment[]).map(normalizePayment);
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updatePayment(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbPayment, "id" | "businessId">>,
    ): Promise<DbPayment | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        // Payment has no updatedAt column; an empty patch just re-reads the row
        // (memory merges {} and returns the row unchanged).
        if (sets.length === 0) {
          const cur = await c.query(
            `SELECT ${PAYMENT_SELECT} FROM "Payment" WHERE "id" = $1 AND "businessId" = $2`,
            [id, businessId],
          );
          return cur.rows[0] ? normalizePayment(cur.rows[0] as DbPayment) : null;
        }
        const r = await c.query(
          `UPDATE "Payment" SET ${sets.join(", ")}` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${PAYMENT_SELECT}`,
          [...values, id, businessId],
        );
        return r.rows[0] ? normalizePayment(r.rows[0] as DbPayment) : null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createHeldSale(h: Omit<DbHeldSale, "id">): Promise<DbHeldSale> {
      const c = await ctx.client();
      try {
        const row = { ...h, id: nid("held") };
        // payload is JSONB (unknown): the object passes through, callers never
        // stringify.
        await c.query(
          'INSERT INTO "HeldSale" ("id", "businessId", "actorId", "payload", "resumedAt", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)',
          [row.id, row.businessId, row.actorId, row.payload, row.resumedAt ?? null],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findHeldSaleById(id: string, businessId: string): Promise<DbHeldSale | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${HELD_SELECT} FROM "HeldSale" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbHeldSale | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listHeldSales(businessId: string, actorId: string): Promise<DbHeldSale[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${HELD_SELECT} FROM "HeldSale" WHERE "businessId" = $1 AND "actorId" = $2 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId, actorId],
        );
        return r.rows as DbHeldSale[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async markHeldResumed(id: string, businessId: string): Promise<void> {
      const c = await ctx.client();
      try {
        // The businessId guard mirrors memory: a mismatched tenant is ignored.
        await c.query(
          'UPDATE "HeldSale" SET "resumedAt" = $1 WHERE "id" = $2 AND "businessId" = $3',
          [new Date(), id, businessId],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async claimIdempotency(r: DbIdempotency): Promise<void> {
      const c = await ctx.client();
      try {
        // The unique index on ("businessId", "key", "commandType") is the
        // arbiter: the first INSERT wins, every later/concurrent claim is
        // ignored here and rejected below — exactly the memory store's throw.
        const inserted = await c.query(
          'INSERT INTO "SaleIdempotency" ("id", "businessId", "key", "commandType", "fingerprint", "resultId", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)' +
            ' ON CONFLICT ("businessId", "key", "commandType") DO NOTHING',
          [nid("idem"), r.businessId, r.key, r.commandType, r.fingerprint, r.resultId],
        );
        if ((inserted.rowCount ?? 0) === 0) throw new Error("IDEMPOTENCY_REPLAY");
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findIdempotency(businessId: string, key: string, commandType: string): Promise<DbIdempotency | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${IDEMPOTENCY_SELECT} FROM "SaleIdempotency"` +
            ' WHERE "businessId" = $1 AND "key" = $2 AND "commandType" = $3',
          [businessId, key, commandType],
        );
        return (r.rows[0] as DbIdempotency | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findLatestSaleForRegister(businessId: string, registerId: string): Promise<DbSale | null> {
      const c = await ctx.client();
      try {
        // Memory scans for the max createdAt with a strict `>` comparison, so
        // among equal timestamps the first-inserted row wins — the "id" ASC
        // tie-break reproduces that (nid ids increase with insertion).
        const r = await c.query(
          `SELECT ${SALE_SELECT} FROM "Sale"` +
            ' WHERE "businessId" = $1 AND "registerId" = $2 AND "status" = \'COMPLETED\'' +
            ' ORDER BY "createdAt" DESC, "id" ASC LIMIT 1',
          [businessId, registerId],
        );
        return (r.rows[0] as DbSale | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    // Per-business receipt sequence. The atomic upsert-increment is safe
    // across processes on its own; callers also hold the sales advisory lock,
    // which keeps draft creation serialized as in memory.
    async nextReceiptNo(businessId: string): Promise<string> {
      const c = await ctx.client();
      try {
        const year = new Date().getUTCFullYear();
        const r = await c.query(
          'INSERT INTO "ReceiptCounter" ("id", "businessId", "seq") VALUES ($1, $2, 1)' +
            ' ON CONFLICT ("businessId") DO UPDATE SET "seq" = "ReceiptCounter"."seq" + 1' +
            ' RETURNING "seq"',
          [nid("rcpt"), businessId],
        );
        return `${year}-${String(r.rows[0]!.seq as number).padStart(6, "0")}`;
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type SalesFamily = ReturnType<typeof salesFamily>;

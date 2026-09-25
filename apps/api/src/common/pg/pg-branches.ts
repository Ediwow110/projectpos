import type { DbBranch, DbStockTransfer, DbStockTransferLine } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The branches family: branches, stock transfers and their lines. Mapping notes:
// - Runtime columns are exactly migration 0009's DDL; the port shapes carry no
//   timestamps, so "createdAt"/"updatedAt" are written but never read back.
// - listBranchesByBusiness replicates the memory sort (name ascending — names
//   are unique per business via the ("businessId","name") index); transfers
//   and lines replicate Map insertion order ("createdAt" ASC where the column
//   exists, else "id" ASC — StockTransferLine has no timestamp column).
// - update* builds the SET clause from the patch's provided keys only (the
//   services spread conditionally, so absent keys stay untouched) and always
//   stamps "updatedAt" = CURRENT_TIMESTAMP like every other family's writes.
//   Transfer state transitions (DRAFT -> IN_TRANSIT -> RECEIVED) are plain
//   patches here; the services own the transition policy.
const BRANCH_COLUMNS = '"id", "businessId", "name", "type", "isActive"';
const TRANSFER_COLUMNS =
  '"id", "businessId", "fromBranchId", "toBranchId", "status", "requestedBy", ' +
  '"dispatchedBy", "receivedBy", "requestId"';
const TRANSFER_LINE_COLUMNS = '"id", "businessId", "transferId", "productId", "qty"';

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

export function branchesFamily(ctx: PgContext) {
  return {
    async createBranch(b: Omit<DbBranch, "id">): Promise<DbBranch> {
      const c = await ctx.client();
      try {
        const row = { ...b, id: nid("br") };
        await c.query(
          'INSERT INTO "Branch" ("id", "businessId", "name", "type", "isActive", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [row.id, row.businessId, row.name, row.type, row.isActive],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listBranchesByBusiness(businessId: string): Promise<DbBranch[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${BRANCH_COLUMNS} FROM "Branch" WHERE "businessId" = $1 ORDER BY "name" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbBranch[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findBranchById(id: string, businessId: string): Promise<DbBranch | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${BRANCH_COLUMNS} FROM "Branch" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbBranch | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateBranch(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbBranch, "id" | "businessId">>,
    ): Promise<DbBranch | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "Branch" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${BRANCH_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbBranch | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createTransfer(t: Omit<DbStockTransfer, "id">): Promise<DbStockTransfer> {
      const c = await ctx.client();
      try {
        const row = { ...t, id: nid("trx") };
        await c.query(
          'INSERT INTO "StockTransfer" ("id", "businessId", "fromBranchId", "toBranchId", "status", "requestedBy", "dispatchedBy", "receivedBy", "requestId", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.fromBranchId, row.toBranchId, row.status,
            row.requestedBy, row.dispatchedBy ?? null, row.receivedBy ?? null, row.requestId,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findTransferById(id: string, businessId: string): Promise<DbStockTransfer | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${TRANSFER_COLUMNS} FROM "StockTransfer" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbStockTransfer | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listTransfersByBusiness(businessId: string): Promise<DbStockTransfer[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${TRANSFER_COLUMNS} FROM "StockTransfer" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbStockTransfer[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateTransfer(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbStockTransfer, "id" | "businessId">>,
    ): Promise<DbStockTransfer | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "StockTransfer" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${TRANSFER_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbStockTransfer | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createTransferLine(l: Omit<DbStockTransferLine, "id">): Promise<DbStockTransferLine> {
      const c = await ctx.client();
      try {
        const row = { ...l, id: nid("tline") };
        // Migration 0009 gives StockTransferLine no timestamp columns.
        await c.query(
          'INSERT INTO "StockTransferLine" ("id", "businessId", "transferId", "productId", "qty")' +
            ' VALUES ($1, $2, $3, $4, $5)',
          [row.id, row.businessId, row.transferId, row.productId, row.qty],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listTransferLines(transferId: string, businessId: string): Promise<DbStockTransferLine[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${TRANSFER_LINE_COLUMNS} FROM "StockTransferLine" WHERE "transferId" = $1 AND "businessId" = $2 ORDER BY "id" ASC`,
          [transferId, businessId],
        );
        return r.rows as DbStockTransferLine[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type BranchesFamily = ReturnType<typeof branchesFamily>;

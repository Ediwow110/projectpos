import type { DbBalance, DbMovement } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The inventory family: append-only stock movements and per-scope balances.
// Mapping notes:
// - Movements mirror the memory store exactly: listMovements' branchId is
//   three-mode (undefined = no filter, null = exactly the NULL-branch rows,
//   value = that branch); the page cursor is the memory id-cursor
//   (`id > after`, ascending, limited) that feeds the audit view.
// - The memory balance key is (businessId, branchId ?? null, productId), so a
//   product holds one row per branch scope. Migration 0014 backs that with a
//   NULLS NOT DISTINCT unique index on ("businessId","productId","branchId"),
//   which lets upsertBalance be a single INSERT ... ON CONFLICT DO UPDATE:
//   the winner keeps the existing row id, exactly like memory's
//   read-modify-write ({ ...existing, qtyOnHand }).
// - Balance reads use memory's findBalance default (branchId = null): an
//   omitted or null branch reads the head-office (NULL-branch) row, not "any"
//   row — reporting and the inventory service depend on that.
const MOVEMENT_SELECT =
  'SELECT "id", "businessId", "productId", "branchId", "qtyDelta", "type", "referenceType", "referenceId",' +
  ' "actorId", "reason", "requestId" FROM "InventoryMovement"';
const BALANCE_SELECT =
  'SELECT "id", "businessId", "productId", "branchId", "qtyOnHand", "updatedAt" FROM "InventoryBalance"';

export function inventoryFamily(ctx: PgContext) {
  return {
    async createMovement(m: Omit<DbMovement, "id">): Promise<DbMovement> {
      const c = await ctx.client();
      try {
        const row = { ...m, id: nid("mov") };
        await c.query(
          'INSERT INTO "InventoryMovement" ("id", "businessId", "productId", "branchId", "qtyDelta", "type",' +
            ' "referenceType", "referenceId", "actorId", "reason", "requestId", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)',
          [
            row.id, m.businessId, m.productId, m.branchId ?? null, m.qtyDelta, m.type,
            m.referenceType ?? null, m.referenceId ?? null, m.actorId, m.reason ?? null, m.requestId,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listMovements(productId: string, businessId: string, branchId?: string | null): Promise<DbMovement[]> {
      const c = await ctx.client();
      try {
        // Three-mode branch filter, exactly the memory expression
        // (branchId === undefined || (m.branchId ?? null) === (branchId ?? null)).
        let sql = `${MOVEMENT_SELECT} WHERE "productId" = $1 AND "businessId" = $2`;
        const params: unknown[] = [productId, businessId];
        if (branchId !== undefined) {
          if (branchId === null) sql += ' AND "branchId" IS NULL';
          else {
            params.push(branchId);
            sql += ' AND "branchId" = $3';
          }
        }
        // Map insertion order ≈ (createdAt, id) — same tiebreak the tenants
        // family uses; ids are client-side monotonic nid() strings.
        sql += ' ORDER BY "createdAt" ASC, "id" ASC';
        const r = await c.query(sql, params);
        return r.rows as DbMovement[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listMovementsByBusiness(businessId: string): Promise<DbMovement[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `${MOVEMENT_SELECT} WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbMovement[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listMovementsPage(businessId: string, afterId: string | null, limit: number): Promise<DbMovement[]> {
      const c = await ctx.client();
      try {
        // Memory: filter businessId, keep `afterId === null || id > afterId`,
        // sort ascending by id (text compare), take limit — the append-only
        // audit view's cursor.
        const r = await c.query(
          `${MOVEMENT_SELECT} WHERE "businessId" = $1 AND ($2::text IS NULL OR "id" > $2)` +
            ' ORDER BY "id" ASC LIMIT $3',
          [businessId, afterId, limit],
        );
        return r.rows as DbMovement[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async upsertBalance(b: Omit<DbBalance, "id">): Promise<DbBalance> {
      const c = await ctx.client();
      try {
        // One statement over the branch-aware unique index (migration 0014).
        // NULLS NOT DISTINCT makes the head-office NULL scope an arbiter too;
        // RETURNING hands back the winner's row — the existing id on update,
        // a fresh one on insert — mirroring memory's read-modify-write.
        const r = await c.query(
          'INSERT INTO "InventoryBalance" ("id", "businessId", "productId", "branchId", "qtyOnHand", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)' +
            ' ON CONFLICT ("businessId", "productId", "branchId") DO UPDATE' +
            ' SET "qtyOnHand" = EXCLUDED."qtyOnHand", "updatedAt" = CURRENT_TIMESTAMP' +
            ' RETURNING "id", "businessId", "productId", "branchId", "qtyOnHand"',
          [nid("bal"), b.businessId, b.productId, b.branchId ?? null, b.qtyOnHand],
        );
        return r.rows[0] as DbBalance;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findBalance(productId: string, businessId: string, branchId?: string | null): Promise<DbBalance | null> {
      const c = await ctx.client();
      try {
        // Memory default (branchId = null): omitted or null reads the
        // head-office row; a value reads exactly that branch.
        let sql = `${BALANCE_SELECT} WHERE "businessId" = $1 AND "productId" = $2`;
        const params: unknown[] = [businessId, productId];
        if (branchId === null || branchId === undefined) sql += ' AND "branchId" IS NULL';
        else {
          params.push(branchId);
          sql += ' AND "branchId" = $3';
        }
        const r = await c.query(sql, params);
        return (r.rows[0] as DbBalance | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listBalances(businessId: string): Promise<DbBalance[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(`${BALANCE_SELECT} WHERE "businessId" = $1 ORDER BY "id" ASC`, [businessId]);
        return r.rows as DbBalance[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type InventoryFamily = ReturnType<typeof inventoryFamily>;

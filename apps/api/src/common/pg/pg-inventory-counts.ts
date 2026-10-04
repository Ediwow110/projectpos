import type { DbInventoryCount, DbInventoryCountLine } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

const COUNT_COLUMNS = '"id", "businessId", "branchId", "countNumber", "status", "scopeType", "name", "notes", "createdBy", "startedAt", "submittedBy", "submittedAt", "approvedBy", "approvedAt", "approvalFingerprint", "postedBy", "postedAt", "cancelledBy", "cancelledAt", "version", "createdAt", "updatedAt"';
const LINE_COLUMNS = '"id", "businessId", "inventoryCountId", "productId", "expectedQtySnapshot", "balanceUpdatedAtSnapshot", "countedQty", "varianceQty", "productNameSnapshot", "skuSnapshot", "notes", "countedBy", "countedAt", "createdAt", "updatedAt"';

function countRow(row: Record<string, unknown>): DbInventoryCount {
  return row as unknown as DbInventoryCount;
}

function lineRow(row: Record<string, unknown>): DbInventoryCountLine {
  return row as unknown as DbInventoryCountLine;
}

function buildSet(patch: Record<string, unknown>, offset = 0): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const sets: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`"${key}" = $${values.length + offset}`);
  }
  return { sql: sets.join(", "), values };
}

export function inventoryCountsFamily(ctx: PgContext) {
  return {
    async nextInventoryCountNo(businessId: string): Promise<string> {
      const year = new Date().getUTCFullYear();
      const c = await ctx.client();
      try {
        const r = await c.query(
          'INSERT INTO "InventoryCountCounter" ("id", "businessId", "seq") VALUES ($1, $2, 1)' +
          ' ON CONFLICT ("businessId") DO UPDATE SET "seq" = "InventoryCountCounter"."seq" + 1 RETURNING "seq"',
          [nid("cntctr"), businessId],
        );
        return `CNT-${year}-${String(r.rows[0]!["seq"] as number).padStart(6, "0")}`;
      } finally { if (ctx.owns()) c.release(); }
    },
    async createInventoryCount(row0: Omit<DbInventoryCount, "id" | "createdAt" | "updatedAt">): Promise<DbInventoryCount> {
      const c = await ctx.client();
      try {
        const row = { ...row0, id: nid("cnt"), createdAt: new Date(), updatedAt: new Date() };
        await c.query(
          `INSERT INTO "InventoryCount" (${COUNT_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
          [row.id,row.businessId,row.branchId,row.countNumber,row.status,row.scopeType,row.name,row.notes,row.createdBy,row.startedAt,row.submittedBy,row.submittedAt,row.approvedBy,row.approvedAt,row.approvalFingerprint,row.postedBy,row.postedAt,row.cancelledBy,row.cancelledAt,row.version],
        );
        return row;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findInventoryCountById(id: string, businessId: string): Promise<DbInventoryCount | null> {
      const c = await ctx.client();
      try { const r = await c.query(`SELECT ${COUNT_COLUMNS} FROM "InventoryCount" WHERE "id"=$1 AND "businessId"=$2`, [id,businessId]); return r.rows[0] ? countRow(r.rows[0]) : null; }
      finally { if (ctx.owns()) c.release(); }
    },
    async listInventoryCountsByBusiness(businessId: string): Promise<DbInventoryCount[]> {
      const c = await ctx.client();
      try { const r = await c.query(`SELECT ${COUNT_COLUMNS} FROM "InventoryCount" WHERE "businessId"=$1 ORDER BY "createdAt" DESC,"id" DESC`, [businessId]); return r.rows.map((row) => countRow(row)); }
      finally { if (ctx.owns()) c.release(); }
    },
    async updateInventoryCount(id: string, businessId: string, patch: Partial<Omit<DbInventoryCount, "id" | "businessId" | "createdAt" | "version">>, expectedVersion: number): Promise<DbInventoryCount | null> {
      const c = await ctx.client();
      try {
        const built = buildSet(patch, 0);
        const prefix = built.sql ? `${built.sql}, ` : "";
        const r = await c.query(`UPDATE "InventoryCount" SET ${prefix}"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${built.values.length+1} AND "businessId"=$${built.values.length+2} AND "version"=$${built.values.length+3} RETURNING ${COUNT_COLUMNS}`, [...built.values,id,businessId,expectedVersion]);
        return r.rows[0] ? countRow(r.rows[0]) : null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async createInventoryCountLine(row0: Omit<DbInventoryCountLine, "id" | "createdAt" | "updatedAt">): Promise<DbInventoryCountLine> {
      const c = await ctx.client();
      try {
        const row = { ...row0, id: nid("cntl"), createdAt: new Date(), updatedAt: new Date() };
        await c.query(`INSERT INTO "InventoryCountLine" (${LINE_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [row.id,row.businessId,row.inventoryCountId,row.productId,row.expectedQtySnapshot,row.balanceUpdatedAtSnapshot,row.countedQty,row.varianceQty,row.productNameSnapshot,row.skuSnapshot,row.notes,row.countedBy,row.countedAt]);
        return row;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listInventoryCountLines(countId: string, businessId: string): Promise<DbInventoryCountLine[]> {
      const c = await ctx.client();
      try { const r = await c.query(`SELECT ${LINE_COLUMNS} FROM "InventoryCountLine" WHERE "inventoryCountId"=$1 AND "businessId"=$2 ORDER BY "createdAt" ASC,"id" ASC`, [countId,businessId]); return r.rows.map((row) => lineRow(row)); }
      finally { if (ctx.owns()) c.release(); }
    },
    async updateInventoryCountLine(id: string, businessId: string, patch: Partial<Omit<DbInventoryCountLine, "id" | "businessId" | "inventoryCountId" | "createdAt">>): Promise<DbInventoryCountLine | null> {
      const c = await ctx.client();
      try { const built = buildSet(patch); const prefix = built.sql ? `${built.sql}, ` : ""; const r = await c.query(`UPDATE "InventoryCountLine" SET ${prefix}"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${built.values.length+1} AND "businessId"=$${built.values.length+2} RETURNING ${LINE_COLUMNS}`, [...built.values,id,businessId]); return r.rows[0] ? lineRow(r.rows[0]) : null; }
      finally { if (ctx.owns()) c.release(); }
    },
    async deleteInventoryCountLines(countId: string, businessId: string): Promise<void> {
      const c = await ctx.client();
      try { await c.query('DELETE FROM "InventoryCountLine" WHERE "inventoryCountId"=$1 AND "businessId"=$2', [countId,businessId]); }
      finally { if (ctx.owns()) c.release(); }
    },
  };
}

export type InventoryCountsFamily = ReturnType<typeof inventoryCountsFamily>;

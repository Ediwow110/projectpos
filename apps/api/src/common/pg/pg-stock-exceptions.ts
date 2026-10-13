import type { DbStockException } from "../db.port";
import { nid, type PgContext } from "./context";

const FIELDS = '"id", "businessId", "productId", "branchId", "kind", "quantity", "expiresOn", "reason", "status", "reportKey", "reportedBy", "createdAt", "disposedBy", "disposedAt", "movementId"';

export function stockExceptionsFamily(ctx: PgContext) {
  return {
    async createStockException(input: Omit<DbStockException, "id" | "createdAt">): Promise<DbStockException> {
      const c = await ctx.client();
      try {
        const id = nid("risk");
        const r = await c.query(
          `INSERT INTO "StockException" ("id","businessId","productId","branchId","kind","quantity","expiresOn","reason","status","reportKey","reportedBy","disposedBy","disposedAt","movementId")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${FIELDS}`,
          [id, input.businessId, input.productId, input.branchId, input.kind, input.quantity, input.expiresOn,
            input.reason, input.status, input.reportKey, input.reportedBy, input.disposedBy, input.disposedAt, input.movementId],
        );
        return r.rows[0] as DbStockException;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findStockExceptionById(id: string, businessId: string): Promise<DbStockException | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${FIELDS} FROM "StockException" WHERE "id"=$1 AND "businessId"=$2`, [id, businessId]);
        return (r.rows[0] as DbStockException | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findStockExceptionByKey(businessId: string, key: string): Promise<DbStockException | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${FIELDS} FROM "StockException" WHERE "businessId"=$1 AND "reportKey"=$2`, [businessId, key]);
        return (r.rows[0] as DbStockException | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listStockExceptions(businessId: string): Promise<DbStockException[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${FIELDS} FROM "StockException" WHERE "businessId"=$1 ORDER BY "createdAt" DESC, "id" DESC`, [businessId]);
        return r.rows as DbStockException[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async disposeStockException(id: string, businessId: string, actorId: string, movementId: string): Promise<DbStockException | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `UPDATE "StockException" SET "status"='DISPOSED', "disposedBy"=$3, "disposedAt"=CURRENT_TIMESTAMP, "movementId"=$4
           WHERE "id"=$1 AND "businessId"=$2 AND "status"='OPEN' RETURNING ${FIELDS}`,
          [id, businessId, actorId, movementId],
        );
        return (r.rows[0] as DbStockException | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
  };
}

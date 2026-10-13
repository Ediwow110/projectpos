import type { AuditEntry } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// Append-only: inserts only, ordered by the store-stamped timestamp.
export function auditFamily(ctx: PgContext) {
  return {
    async appendAudit(e: AuditEntry): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'INSERT INTO "AuditLog" ("id", "businessId", "actorId", "action", "entityType", "entityId", "requestId", "beforeSnapshot", "afterSnapshot", "reason", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, CURRENT_TIMESTAMP))',
          [
            nid("aud"), e.businessId, e.actorId, e.action, e.entityType, e.entityId,
            e.requestId, e.before === undefined ? null : JSON.stringify(e.before),
            e.after === undefined ? null : JSON.stringify(e.after), e.reason ?? null, e.at ?? null,
          ],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listAudit(businessId?: string): Promise<AuditEntry[]> {
      const c = await ctx.client();
      try {
        const rows = await c.query(
          'SELECT "businessId", "actorId", "action", "entityType", "entityId", "requestId", "beforeSnapshot", "afterSnapshot", "reason", "createdAt"' +
          ' FROM "AuditLog" ' + (businessId ? 'WHERE "businessId" = $1 ' : '') +
            'ORDER BY "createdAt" ASC, "id" ASC',
          businessId ? [businessId] : [],
        );
        return rows.rows.map((r) => ({
          businessId: r.businessId as string | null,
          actorId: r.actorId as string,
          action: r.action as string,
          entityType: r.entityType as string,
          entityId: r.entityId as string,
          requestId: r.requestId as string,
          at: r.createdAt as Date,
          ...(r.reason !== null ? { reason: r.reason as string } : {}),
          ...(r.beforeSnapshot !== null ? { before: r.beforeSnapshot } : {}),
          ...(r.afterSnapshot !== null ? { after: r.afterSnapshot } : {}),
        }));
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

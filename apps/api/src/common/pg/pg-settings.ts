import { nid } from "./context";
import type { PgContext } from "./context";

// The DDL stores settings as key/value JSONB rows; the port exposes one
// merged object per business, so reads aggregate and saves replace all rows
// for the business inside the ambient transaction.
export function settingsFamily(ctx: PgContext) {
  return {
    async getSettings(businessId: string): Promise<Record<string, unknown>> {
      const c = await ctx.client();
      try {
        const rows = await c.query(
          'SELECT "key", "value" FROM "Setting" WHERE "businessId" = $1',
          [businessId],
        );
        const out: Record<string, unknown> = {};
        for (const row of rows.rows) out[row.key as string] = row.value;
        return out;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async saveSettings(businessId: string, settings: Record<string, unknown>): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('DELETE FROM "Setting" WHERE "businessId" = $1', [businessId]);
        for (const [key, value] of Object.entries(settings)) {
          await c.query(
            'INSERT INTO "Setting" ("id", "businessId", "key", "value", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
            [nid("set"), businessId, key, JSON.stringify(value)],
          );
        }
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

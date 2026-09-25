import type { AuditEntry, DbBusiness, DbPlan, DbPort } from "../db.port";
import { nid, PgContext } from "./context";
import { settingsFamily } from "./pg-settings";
import { auditFamily } from "./pg-audit";

// Phase 12: the PostgreSQL-backed DbPort. Composed from per-family modules
// over one PgContext. Becomes `implements DbPort` complete in the Task 13
// boot swap; until then only landed families exist and the harness casts.
export class PgDbPort {
  private readonly settings: ReturnType<typeof settingsFamily>;
  private readonly audit: ReturnType<typeof auditFamily>;

  constructor(private readonly ctx: PgContext) {
    this.settings = settingsFamily(ctx);
    this.audit = auditFamily(ctx);
  }

  // withLock/withTransaction come straight from the context so every family
  // shares the transaction scope.
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.ctx.withLock(key, fn);
  }
  withTransaction<T>(fn: (ctx: PgContext) => Promise<T>): Promise<T> {
    return this.ctx.withTransaction(fn);
  }
  async close(): Promise<void> {
    await this.ctx.close();
  }

  getSettings(businessId: string): Promise<Record<string, unknown>> {
    return this.settings.getSettings(businessId);
  }
  saveSettings(businessId: string, settings: Record<string, unknown>): Promise<void> {
    return this.settings.saveSettings(businessId, settings);
  }
  appendAudit(e: AuditEntry): Promise<void> {
    return this.audit.appendAudit(e);
  }
  listAudit(): Promise<AuditEntry[]> {
    return this.audit.listAudit();
  }

  // Minimal tenant + plan reads needed by the foundation tests and every
  // family's FK graph; the full tenants family is Task 3.
  async createBusiness(b: Omit<DbBusiness, "id">): Promise<DbBusiness> {
    const c = await this.ctx.client();
    try {
      const row = { ...b, id: nid("biz") };
      await c.query(
        'INSERT INTO "Business" ("id", "name", "currency", "createdAt", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [row.id, row.name, row.currency],
      );
      return row;
    } finally {
      if (this.ctx.owns()) c.release();
    }
  }
  async findBusinessById(id: string): Promise<DbBusiness | null> {
    const c = await this.ctx.client();
    try {
      const r = await c.query('SELECT "id", "name", "currency" FROM "Business" WHERE "id" = $1', [id]);
      return (r.rows[0] as DbBusiness | undefined) ?? null;
    } finally {
      if (this.ctx.owns()) c.release();
    }
  }
  async listPlans(): Promise<DbPlan[]> {
    const c = await this.ctx.client();
    try {
      const r = await c.query('SELECT "id", "key", "name", "allowances", "pricesMinor", "isActive" FROM "Plan" ORDER BY "key" ASC');
      return r.rows as DbPlan[];
    } finally {
      if (this.ctx.owns()) c.release();
    }
  }
  async findPlanByKey(key: string): Promise<DbPlan | null> {
    const c = await this.ctx.client();
    try {
      const r = await c.query('SELECT "id", "key", "name", "allowances", "pricesMinor", "isActive" FROM "Plan" WHERE "key" = $1', [key]);
      return (r.rows[0] as DbPlan | undefined) ?? null;
    } finally {
      if (this.ctx.owns()) c.release();
    }
  }
}

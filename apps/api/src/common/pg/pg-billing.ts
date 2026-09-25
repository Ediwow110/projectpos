import type { DbFeatureFlag, DbInvoice, DbPlan, DbSubscription, DbUsageCounter, DbWebhookEvent } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The billing family: plans (read-only), subscriptions, invoices, usage
// counters, feature flags and billing webhook events. Mapping notes:
// - Plans are seeded by migration 0011 / the boot harness; listed by key.
// - Subscription has UNIQUE businessId, so upsertSubscription is one INSERT
//   ... ON CONFLICT ("businessId") DO UPDATE; providerRef follows memory's
//   `s.providerRef ?? existing.providerRef` via COALESCE (omitted and explicit
//   null both keep the stored value).
// - UsageCounter's id mirrors memory's composite `${businessId}:${key}:${period}`;
//   the ("businessId","key","period") unique index arbitrates re-sets onto the
//   same row. The DDL has no createdAt, so listCounters orders by id — a
//   stable order, like memory's fixed Map positions.
// - FeatureFlag has two PARTIAL unique indexes (businessId IS NULL and
//   businessId = $1), so no single ON CONFLICT arbiter covers both scopes:
//   setFlag is memory's read-modify-write (find the scope's row for the key,
//   update it in place, else insert) on the ambient transaction's client.
// - BillingWebhookEvent UNIQUE (provider, eventId) backs the exactly-once
//   claim: INSERT ... ON CONFLICT DO NOTHING; rowCount 0 -> null (the
//   concurrent loser), else the inserted row.
// - update* builds the SET clause from the patch's provided keys only (the
//   services spread conditionally, so absent keys stay untouched) and stamps
//   "updatedAt" = CURRENT_TIMESTAMP where the column exists.
const PLAN_COLUMNS = '"id", "key", "name", "allowances", "pricesMinor", "isActive"';
const SUBSCRIPTION_COLUMNS = '"id", "businessId", "planId", "status", "trialEndsAt", "currentPeriodEnd", "providerRef"';
const INVOICE_COLUMNS =
  '"id", "businessId", "subscriptionId", "periodStart", "periodEnd", "amountMinor", "currency", "status", "issuedAt", "paidAt"';
const COUNTER_COLUMNS = '"id", "businessId", "key", "period", "count"';
const FLAG_COLUMNS = '"id", "businessId", "key", "enabled"';
const WEBHOOK_COLUMNS = '"id", "businessId", "provider", "eventId", "type", "payload", "status", "receivedAt"';

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

export function billingFamily(ctx: PgContext) {
  return {
    async listPlans(): Promise<DbPlan[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${PLAN_COLUMNS} FROM "Plan" ORDER BY "key" ASC`);
        return r.rows as DbPlan[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findPlanByKey(key: string): Promise<DbPlan | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${PLAN_COLUMNS} FROM "Plan" WHERE "key" = $1`, [key]);
        return (r.rows[0] as DbPlan | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async getSubscription(businessId: string): Promise<DbSubscription | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${SUBSCRIPTION_COLUMNS} FROM "Subscription" WHERE "businessId" = $1`,
          [businessId],
        );
        return (r.rows[0] as DbSubscription | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async upsertSubscription(
      s: Omit<DbSubscription, "id" | "providerRef"> & { providerRef?: string | null },
    ): Promise<DbSubscription> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'INSERT INTO "Subscription" ("id", "businessId", "planId", "status", "trialEndsAt", "currentPeriodEnd", "providerRef", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)' +
            ' ON CONFLICT ("businessId") DO UPDATE SET' +
            ' "planId" = EXCLUDED."planId", "status" = EXCLUDED."status", "trialEndsAt" = EXCLUDED."trialEndsAt",' +
            ' "currentPeriodEnd" = EXCLUDED."currentPeriodEnd",' +
            ' "providerRef" = COALESCE(EXCLUDED."providerRef", "Subscription"."providerRef"),' +
            ' "updatedAt" = CURRENT_TIMESTAMP' +
            ` RETURNING ${SUBSCRIPTION_COLUMNS}`,
          [nid("sub"), s.businessId, s.planId, s.status, s.trialEndsAt, s.currentPeriodEnd, s.providerRef ?? null],
        );
        return r.rows[0] as DbSubscription;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateSubscription(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbSubscription, "id" | "businessId">>,
    ): Promise<DbSubscription | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "Subscription" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${SUBSCRIPTION_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbSubscription | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listInvoices(businessId: string): Promise<DbInvoice[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${INVOICE_COLUMNS} FROM "Invoice" WHERE "businessId" = $1 ORDER BY "issuedAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbInvoice[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createInvoice(i: Omit<DbInvoice, "id" | "issuedAt">): Promise<DbInvoice> {
      const c = await ctx.client();
      try {
        // issuedAt is the store's arrival stamp (memory sets `new Date()`),
        // written here and returned so callers see the persisted value.
        const r = await c.query(
          'INSERT INTO "Invoice" ("id", "businessId", "subscriptionId", "periodStart", "periodEnd", "amountMinor", "currency", "status", "issuedAt", "paidAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9)' +
            ` RETURNING ${INVOICE_COLUMNS}`,
          [nid("inv"), i.businessId, i.subscriptionId, i.periodStart, i.periodEnd, i.amountMinor, i.currency, i.status, i.paidAt],
        );
        return r.rows[0] as DbInvoice;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateInvoice(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbInvoice, "id" | "businessId">>,
    ): Promise<DbInvoice | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        // Invoice carries no updatedAt column; an empty patch reads the row
        // back unchanged, exactly like memory's spread.
        const r = sets.length
          ? await c.query(
              `UPDATE "Invoice" SET ${sets.join(", ")}` +
                ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
                ` RETURNING ${INVOICE_COLUMNS}`,
              [...values, id, businessId],
            )
          : await c.query(`SELECT ${INVOICE_COLUMNS} FROM "Invoice" WHERE "id" = $1 AND "businessId" = $2`, [id, businessId]);
        return (r.rows[0] as DbInvoice | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listCounters(businessId: string): Promise<DbUsageCounter[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${COUNTER_COLUMNS} FROM "UsageCounter" WHERE "businessId" = $1 ORDER BY "id" ASC`,
          [businessId],
        );
        return r.rows as DbUsageCounter[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async setCounter(businessId: string, key: string, period: string, count: number): Promise<DbUsageCounter> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'INSERT INTO "UsageCounter" ("id", "businessId", "key", "period", "count", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)' +
            ' ON CONFLICT ("businessId", "key", "period") DO UPDATE SET' +
            ' "count" = EXCLUDED."count", "updatedAt" = CURRENT_TIMESTAMP' +
            ` RETURNING ${COUNTER_COLUMNS}`,
          [`${businessId}:${key}:${period}`, businessId, key, period, count],
        );
        return r.rows[0] as DbUsageCounter;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async getFlag(businessId: string | null, key: string): Promise<DbFeatureFlag | null> {
      const c = await ctx.client();
      try {
        // businessId null reads the global (NULL) scope only, never a tenant row.
        const r =
          businessId === null
            ? await c.query(`SELECT ${FLAG_COLUMNS} FROM "FeatureFlag" WHERE "businessId" IS NULL AND "key" = $1`, [key])
            : await c.query(`SELECT ${FLAG_COLUMNS} FROM "FeatureFlag" WHERE "businessId" = $1 AND "key" = $2`, [businessId, key]);
        return (r.rows[0] as DbFeatureFlag | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async setFlag(f: { businessId: string | null; key: string; enabled: boolean }): Promise<DbFeatureFlag> {
      const c = await ctx.client();
      try {
        // The two partial unique indexes leave no single ON CONFLICT arbiter,
        // and memory's semantics are exactly read-modify-write: find the
        // scope's row for the key, update it in place, else insert. Both
        // statements share the ambient transaction's client; the SELECT FOR
        // UPDATE holds the row lock for the pair (callers hold the business
        // lock, and single-instance memory ran serialized the same way).
        const existing =
          f.businessId === null
            ? await c.query(`SELECT ${FLAG_COLUMNS} FROM "FeatureFlag" WHERE "businessId" IS NULL AND "key" = $1 FOR UPDATE`, [f.key])
            : await c.query(`SELECT ${FLAG_COLUMNS} FROM "FeatureFlag" WHERE "businessId" = $1 AND "key" = $2 FOR UPDATE`, [f.businessId, f.key]);
        if (existing.rows.length > 0) {
          const r = await c.query(
            `UPDATE "FeatureFlag" SET "enabled" = $1 WHERE "id" = $2 RETURNING ${FLAG_COLUMNS}`,
            [f.enabled, existing.rows[0].id as string],
          );
          return r.rows[0] as DbFeatureFlag;
        }
        const r = await c.query(
          `INSERT INTO "FeatureFlag" ("id", "businessId", "key", "enabled") VALUES ($1, $2, $3, $4) RETURNING ${FLAG_COLUMNS}`,
          [nid("flag"), f.businessId, f.key, f.enabled],
        );
        return r.rows[0] as DbFeatureFlag;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findWebhookEvent(provider: string, eventId: string): Promise<DbWebhookEvent | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${WEBHOOK_COLUMNS} FROM "BillingWebhookEvent" WHERE "provider" = $1 AND "eventId" = $2`,
          [provider, eventId],
        );
        return (r.rows[0] as DbWebhookEvent | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createWebhookEvent(e: Omit<DbWebhookEvent, "id" | "receivedAt">): Promise<DbWebhookEvent> {
      const c = await ctx.client();
      try {
        // receivedAt is the arrival stamp memory sets at insert.
        const r = await c.query(
          'INSERT INTO "BillingWebhookEvent" ("id", "businessId", "provider", "eventId", "type", "payload", "status", "receivedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)' +
            ` RETURNING ${WEBHOOK_COLUMNS}`,
          [nid("whev"), e.businessId, e.provider, e.eventId, e.type, e.payload, e.status],
        );
        return r.rows[0] as DbWebhookEvent;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async claimWebhookEvent(e: Omit<DbWebhookEvent, "id" | "receivedAt">): Promise<DbWebhookEvent | null> {
      const c = await ctx.client();
      try {
        // Exactly-once primitive: the ("provider","eventId") unique index
        // arbitrates. rowCount 0 means a redelivery or concurrent loser —
        // return null instead of the winner's row, mirroring memory's claim.
        const r = await c.query(
          'INSERT INTO "BillingWebhookEvent" ("id", "businessId", "provider", "eventId", "type", "payload", "status", "receivedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)' +
            ' ON CONFLICT ("provider", "eventId") DO NOTHING' +
            ` RETURNING ${WEBHOOK_COLUMNS}`,
          [nid("whev"), e.businessId, e.provider, e.eventId, e.type, e.payload, e.status],
        );
        return (r.rows[0] as DbWebhookEvent | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateWebhookEventStatus(id: string, status: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('UPDATE "BillingWebhookEvent" SET "status" = $1 WHERE "id" = $2', [status, id]);
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateWebhookEventReceivedAt(id: string, receivedAt: Date): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('UPDATE "BillingWebhookEvent" SET "receivedAt" = $1 WHERE "id" = $2', [receivedAt, id]);
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async deleteWebhookEvent(id: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('DELETE FROM "BillingWebhookEvent" WHERE "id" = $1', [id]);
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type BillingFamily = ReturnType<typeof billingFamily>;

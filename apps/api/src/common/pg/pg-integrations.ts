import type { DbApiToken, DbDisplayToken, DbPrintJob, DbPrinter, DbReceiptDelivery, DbShiftCorrection } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The integrations family: api tokens, printers, print jobs, display tokens,
// platform support grants, shift corrections and receipt shares. Mapping notes:
// - Runtime columns are exactly the migration DDL; "createdAt"/"updatedAt" are
//   never exposed (memory rows carry no such fields) except PrintJob and
//   ShiftCorrection, whose runtime types include createdAt.
// - "scopes" is JSONB: the array is stringified for the write and comes back
//   parsed (pg deserializes JSONB automatically).
// - listPrinters/listApiTokens/... replicate the memory Map insertion order via
//   ORDER BY "createdAt" ASC, "id" ASC; PrinterDevice has no timestamp column,
//   so its insertion order is the (time-prefixed, process-monotonic) id.
// - findValidSupportGrant/findValidReceiptShare apply the memory validity
//   filter (unused + not expired); findDisplayToken does NOT — the display
//   feed checks expiry itself, exactly like memory.
// - updatePrintJob's expectedStatus is a compare-and-set: one conditional
//   UPDATE returns no row on status mismatch, which maps to memory's null.
const API_TOKEN_COLUMNS =
  '"id", "businessId", "name", "tokenHash", "prefix", "scopes", "revokedAt", "expiresAt"';
const PRINTER_COLUMNS = '"id", "businessId", "branchId", "name", "width", "connection", "agentTokenHash", "lastSeenAt"';
const PRINT_JOB_COLUMNS =
  '"id", "businessId", "printerId", "receiptNo", "layout", "status", "payload", "attempts", "createdAt"';
const DISPLAY_TOKEN_COLUMNS = '"id", "businessId", "registerId", "tokenHash", "expiresAt"';
const SHIFT_CORRECTION_COLUMNS =
  '"id", "businessId", "shiftId", "amountMinor", "reason", "actorId", "requestId", "createdAt"';
const RECEIPT_DELIVERY_COLUMNS =
  '"id", "businessId", "saleId", "channel", "recipient", "status", "idempotencyKey", "errorCode", "sentAt", "createdAt"';

// Column names come from the typed patch keys (never user input), so quoting
// them is safe. Keys explicitly set to undefined are skipped.
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

export function integrationsFamily(ctx: PgContext) {
  return {
    async createApiToken(t: Omit<DbApiToken, "id">): Promise<DbApiToken> {
      const c = await ctx.client();
      try {
        const row = { ...t, id: nid("tok") };
        await c.query(
          'INSERT INTO "ApiToken" ("id", "businessId", "name", "tokenHash", "prefix", "scopes", "revokedAt", "expiresAt", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)',
          [row.id, row.businessId, row.name, row.tokenHash, row.prefix, JSON.stringify(row.scopes), row.revokedAt, row.expiresAt],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listApiTokens(businessId: string): Promise<DbApiToken[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${API_TOKEN_COLUMNS} FROM "ApiToken" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbApiToken[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findApiTokenByPrefix(prefix: string): Promise<DbApiToken | null> {
      const c = await ctx.client();
      try {
        // First match in insertion order — exactly the memory scan.
        const r = await c.query(
          `SELECT ${API_TOKEN_COLUMNS} FROM "ApiToken" WHERE "prefix" = $1 ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`,
          [prefix],
        );
        return (r.rows[0] as DbApiToken | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listApiTokensByPrefix(prefix: string): Promise<DbApiToken[]> {
      const c = await ctx.client();
      try {
        // Prefixes can collide: the guard checks every candidate's full hash.
        const r = await c.query(
          `SELECT ${API_TOKEN_COLUMNS} FROM "ApiToken" WHERE "prefix" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [prefix],
        );
        return r.rows as DbApiToken[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async revokeApiToken(id: string, businessId: string, revokedAt: Date): Promise<DbApiToken | null> {
      const c = await ctx.client();
      try {
        // The businessId guard mirrors memory: a mismatched tenant is ignored.
        const r = await c.query(
          `UPDATE "ApiToken" SET "revokedAt" = $1 WHERE "id" = $2 AND "businessId" = $3 RETURNING ${API_TOKEN_COLUMNS}`,
          [revokedAt, id, businessId],
        );
        return (r.rows[0] as DbApiToken | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createPrinter(p: Omit<DbPrinter, "id">): Promise<DbPrinter> {
      const c = await ctx.client();
      try {
        const row = { ...p, id: nid("prt") };
        await c.query(
          'INSERT INTO "PrinterDevice" ("id", "businessId", "branchId", "name", "width", "connection", "agentTokenHash", "lastSeenAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [row.id, row.businessId, row.branchId, row.name, row.width, row.connection, row.agentTokenHash, row.lastSeenAt ?? null],
        );
        return { ...row, lastSeenAt: row.lastSeenAt ?? null };
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listPrinters(businessId: string): Promise<DbPrinter[]> {
      const c = await ctx.client();
      try {
        // No timestamp column on PrinterDevice; ids are insertion-ordered.
        const r = await c.query(
          `SELECT ${PRINTER_COLUMNS} FROM "PrinterDevice" WHERE "businessId" = $1 ORDER BY "id" ASC`,
          [businessId],
        );
        return r.rows as DbPrinter[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findPrinterById(id: string, businessId: string): Promise<DbPrinter | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PRINTER_COLUMNS} FROM "PrinterDevice" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbPrinter | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findPrinterByAgentTokenHash(tokenHash: string): Promise<DbPrinter | null> {
      const c = await ctx.client();
      try {
        // SQL null-comparison mirrors memory's agentTokenHash !== null guard;
        // the partial unique index means at most one row can match.
        const r = await c.query(
          `SELECT ${PRINTER_COLUMNS} FROM "PrinterDevice" WHERE "agentTokenHash" = $1`,
          [tokenHash],
        );
        return (r.rows[0] as DbPrinter | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updatePrinter(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbPrinter, "id" | "businessId">>,
    ): Promise<DbPrinter | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "PrinterDevice" SET ${sets.length ? sets.join(", ") : '"id" = "id"'}` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${PRINTER_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbPrinter | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createPrintJob(j: Omit<DbPrintJob, "id">): Promise<DbPrintJob> {
      const c = await ctx.client();
      try {
        const row = { ...j, id: nid("pjob") };
        await c.query(
          'INSERT INTO "PrintJob" ("id", "businessId", "printerId", "receiptNo", "layout", "status", "payload", "attempts", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [row.id, row.businessId, row.printerId, row.receiptNo, row.layout, row.status, row.payload, row.attempts, row.createdAt],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findPrintJobById(id: string, businessId: string): Promise<DbPrintJob | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PRINT_JOB_COLUMNS} FROM "PrintJob" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbPrintJob | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listPrintJobs(businessId: string, status?: string): Promise<DbPrintJob[]> {
      const c = await ctx.client();
      try {
        // FIFO: the (printerId, createdAt) index serves this ordering.
        const r = await c.query(
          `SELECT ${PRINT_JOB_COLUMNS} FROM "PrintJob" WHERE "businessId" = $1 AND ($2::text IS NULL OR "status" = $2)` +
            ' ORDER BY "createdAt" ASC, "id" ASC',
          [businessId, status ?? null],
        );
        return r.rows as DbPrintJob[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updatePrintJob(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbPrintJob, "id" | "businessId">>,
      expectedStatus?: string,
    ): Promise<DbPrintJob | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        // One conditional UPDATE is the compare-and-set: a status mismatch (or
        // unknown/cross-tenant id) matches no row and returns null, exactly
        // memory's behavior — and atomic under concurrency. The no-op
        // assignment keeps an empty patch a valid UPDATE (memory returns the
        // row unchanged for one).
        const r = await c.query(
          `UPDATE "PrintJob" SET ${sets.length ? sets.join(", ") : '"id" = "id"'}` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` AND ($${values.length + 3}::text IS NULL OR "status" = $${values.length + 3})` +
            ` RETURNING ${PRINT_JOB_COLUMNS}`,
          [...values, id, businessId, expectedStatus ?? null],
        );
        return (r.rows[0] as DbPrintJob | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createDisplayToken(t: Omit<DbDisplayToken, "id">): Promise<DbDisplayToken> {
      const c = await ctx.client();
      try {
        const row = { ...t, id: nid("dtok") };
        await c.query(
          'INSERT INTO "DisplayToken" ("id", "businessId", "registerId", "tokenHash", "expiresAt", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)',
          [row.id, row.businessId, row.registerId, row.tokenHash, row.expiresAt],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findDisplayToken(tokenHash: string): Promise<DbDisplayToken | null> {
      const c = await ctx.client();
      try {
        // Returned regardless of expiry; the display feed filters it (memory
        // behavior — findDisplayToken has no validity check).
        const r = await c.query(
          `SELECT ${DISPLAY_TOKEN_COLUMNS} FROM "DisplayToken" WHERE "tokenHash" = $1`,
          [tokenHash],
        );
        return (r.rows[0] as DbDisplayToken | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createSupportGrant(g: { purpose: string; actorId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }> {
      const c = await ctx.client();
      try {
        const id = nid("sup");
        await c.query(
          'INSERT INTO "PlatformSupportGrant" ("id", "purpose", "actorId", "tokenHash", "expiresAt", "usedAt", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, NULL, CURRENT_TIMESTAMP)',
          [id, g.purpose, g.actorId, g.tokenHash, g.expiresAt],
        );
        return { id };
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findValidSupportGrant(tokenHash: string): Promise<{ id: string; purpose: string; actorId: string; expiresAt: Date } | null> {
      const c = await ctx.client();
      try {
        // Valid = unused and not expired: memory's usedAt !== null /
        // expiresAt <= Date.now() guard becomes the WHERE clause.
        const r = await c.query(
          'SELECT "id", "purpose", "actorId", "expiresAt" FROM "PlatformSupportGrant"' +
            ' WHERE "tokenHash" = $1 AND "usedAt" IS NULL AND "expiresAt" > $2',
          [tokenHash, new Date()],
        );
        return (r.rows[0] as { id: string; purpose: string; actorId: string; expiresAt: Date } | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async markSupportGrantUsed(id: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('UPDATE "PlatformSupportGrant" SET "usedAt" = $1 WHERE "id" = $2', [new Date(), id]);
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createManagerApprovalGrant(g: {
      businessId: string;
      requesterId: string;
      approverId: string;
      permission: string;
      fingerprint: string;
      tokenHash: string;
      expiresAt: Date;
    }): Promise<{ id: string }> {
      const c = await ctx.client();
      try {
        const id = nid("mag");
        await c.query(
          'INSERT INTO "ManagerApprovalGrant" ("id", "businessId", "requesterId", "approverId", "permission", "fingerprint", "tokenHash", "expiresAt", "usedAt", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, CURRENT_TIMESTAMP)',
          [id, g.businessId, g.requesterId, g.approverId, g.permission, g.fingerprint, g.tokenHash, g.expiresAt],
        );
        return { id };
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findValidManagerApprovalGrant(
      tokenHash: string,
      businessId: string,
      requesterId: string,
      permission: string,
    ): Promise<{ id: string; approverId: string; fingerprint: string; expiresAt: Date } | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT "id", "approverId", "fingerprint", "expiresAt" FROM "ManagerApprovalGrant"' +
            ' WHERE "tokenHash" = $1 AND "businessId" = $2 AND "requesterId" = $3 AND "permission" = $4' +
            ' AND "usedAt" IS NULL AND "expiresAt" > $5',
          [tokenHash, businessId, requesterId, permission, new Date()],
        );
        return (r.rows[0] as { id: string; approverId: string; fingerprint: string; expiresAt: Date } | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async markManagerApprovalGrantUsed(id: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('UPDATE "ManagerApprovalGrant" SET "usedAt" = $1 WHERE "id" = $2', [new Date(), id]);
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createShiftCorrection(c: { businessId: string; shiftId: string; amountMinor: number; reason: string; actorId: string; requestId: string }): Promise<DbShiftCorrection> {
      const client = await ctx.client();
      try {
        // createdAt is a runtime field here: stamp it client-side (like
        // memory) and store the same value so reads round-trip exactly.
        const row = { ...c, id: nid("shcor"), createdAt: new Date() };
        await client.query(
          'INSERT INTO "ShiftCorrection" ("id", "businessId", "shiftId", "amountMinor", "reason", "actorId", "requestId", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [row.id, row.businessId, row.shiftId, row.amountMinor, row.reason, row.actorId, row.requestId, row.createdAt],
        );
        return row;
      } finally {
        if (ctx.owns()) client.release();
      }
    },

    async listShiftCorrections(businessId: string, shiftId: string): Promise<DbShiftCorrection[]> {
      const client = await ctx.client();
      try {
        const r = await client.query(
          `SELECT ${SHIFT_CORRECTION_COLUMNS} FROM "ShiftCorrection" WHERE "businessId" = $1 AND "shiftId" = $2` +
            ' ORDER BY "createdAt" ASC, "id" ASC',
          [businessId, shiftId],
        );
        return r.rows as DbShiftCorrection[];
      } finally {
        if (ctx.owns()) client.release();
      }
    },

    async createReceiptShare(s: { businessId: string; saleId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }> {
      const c = await ctx.client();
      try {
        const id = nid("rsh");
        await c.query(
          'INSERT INTO "ReceiptShare" ("id", "businessId", "saleId", "tokenHash", "expiresAt", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)',
          [id, s.businessId, s.saleId, s.tokenHash, s.expiresAt],
        );
        return { id };
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findValidReceiptShare(tokenHash: string): Promise<{ id: string; businessId: string; saleId: string; expiresAt: Date } | null> {
      const c = await ctx.client();
      try {
        // Valid = not expired: memory's expiresAt <= Date.now() -> null guard.
        const r = await c.query(
          'SELECT "id", "businessId", "saleId", "expiresAt" FROM "ReceiptShare" WHERE "tokenHash" = $1 AND "expiresAt" > $2',
          [tokenHash, new Date()],
        );
        return (r.rows[0] as { id: string; businessId: string; saleId: string; expiresAt: Date } | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async claimReceiptDelivery(d: Omit<DbReceiptDelivery, "id" | "createdAt">): Promise<{ delivery: DbReceiptDelivery; claimed: boolean }> {
      const c = await ctx.client();
      try {
        const row: DbReceiptDelivery = { ...d, id: nid("rdl"), createdAt: new Date() };
        const inserted = await c.query(
          'INSERT INTO "ReceiptDelivery" ("id", "businessId", "saleId", "channel", "recipient", "status", "idempotencyKey", "errorCode", "sentAt", "createdAt")' +
            ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)' +
            ' ON CONFLICT ("businessId", "idempotencyKey") DO NOTHING' +
            ` RETURNING ${RECEIPT_DELIVERY_COLUMNS}`,
          [row.id, row.businessId, row.saleId, row.channel, row.recipient, row.status, row.idempotencyKey, row.errorCode, row.sentAt, row.createdAt],
        );
        if (inserted.rows[0]) return { delivery: inserted.rows[0] as DbReceiptDelivery, claimed: true };
        const existing = await c.query(
          `SELECT ${RECEIPT_DELIVERY_COLUMNS} FROM "ReceiptDelivery" WHERE "businessId" = $1 AND "idempotencyKey" = $2`,
          [d.businessId, d.idempotencyKey],
        );
        return { delivery: existing.rows[0] as DbReceiptDelivery, claimed: false };
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateReceiptDelivery(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbReceiptDelivery, "id" | "businessId" | "saleId" | "channel" | "recipient" | "idempotencyKey" | "createdAt">>,
    ): Promise<DbReceiptDelivery | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "ReceiptDelivery" SET ${sets.length ? sets.join(", ") : '"id" = "id"'}` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${RECEIPT_DELIVERY_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbReceiptDelivery | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listReceiptDeliveries(businessId: string, saleId: string): Promise<DbReceiptDelivery[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${RECEIPT_DELIVERY_COLUMNS} FROM "ReceiptDelivery" WHERE "businessId" = $1 AND "saleId" = $2 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId, saleId],
        );
        return r.rows as DbReceiptDelivery[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type IntegrationsFamily = ReturnType<typeof integrationsFamily>;

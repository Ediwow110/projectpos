import type { DbAccountingAccount, DbAccountingActivation, DbAccountingBackfillIssue, DbAccountingBackfillRun, DbJournalAccountTotal, DbJournalEntry, DbJournalEntryCreate, DbJournalLine, DbJournalPageQuery, DbJournalTotalsQuery } from "../db.port";
import { nid, type PgContext } from "./context";

function safeMinor(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("ACCOUNTING_INVALID_AMOUNT");
  return number;
}

function mapLines(rows: Array<Record<string, unknown>>): DbJournalLine[] {
  return rows.map((row) => ({
    id: String(row["id"]), businessId: String(row["businessId"]), entryId: String(row["entryId"]),
    accountId: String(row["accountId"]), debitMinor: safeMinor(row["debitMinor"]), creditMinor: safeMinor(row["creditMinor"]),
    memo: row["memo"] === null ? null : String(row["memo"]), position: Number(row["position"]),
  }));
}

export function accountingFamily(ctx: PgContext) {
  return {
    async createAccountingAccount(input: Omit<DbAccountingAccount, "id" | "createdAt" | "updatedAt">): Promise<DbAccountingAccount> {
      const client = await ctx.client();
      try {
        const id = nid("acct");
        const result = await client.query(
          'INSERT INTO "AccountingAccount" ("id","businessId","code","name","type","normalSide","isSystem","isActive","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP) RETURNING *',
          [id, input.businessId, input.code, input.name, input.type, input.normalSide, input.isSystem, input.isActive],
        );
        return result.rows[0] as DbAccountingAccount;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new Error("CONFLICT");
        throw error;
      } finally {
        if (ctx.owns()) client.release();
      }
    },
    async findAccountingAccountByCode(businessId: string, code: string): Promise<DbAccountingAccount | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "AccountingAccount" WHERE "businessId"=$1 AND "code"=$2', [businessId, code]);
        return result.rows[0] as DbAccountingAccount | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async listAccountingAccounts(businessId: string): Promise<DbAccountingAccount[]> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "AccountingAccount" WHERE "businessId"=$1 ORDER BY "code"', [businessId]);
        return result.rows as DbAccountingAccount[];
      } finally { if (ctx.owns()) client.release(); }
    },
    async isAccountingAccountUsed(businessId: string, accountId: string): Promise<boolean> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT 1 FROM "JournalLine" WHERE "businessId"=$1 AND "accountId"=$2 LIMIT 1', [businessId, accountId]);
        return result.rowCount !== 0;
      } finally { if (ctx.owns()) client.release(); }
    },
    async updateAccountingAccount(id: string, businessId: string, patch: Partial<Pick<DbAccountingAccount, "name" | "isActive">>): Promise<DbAccountingAccount | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('UPDATE "AccountingAccount" SET "name"=COALESCE($3,"name"),"isActive"=COALESCE($4,"isActive"),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "businessId"=$2 RETURNING *', [id, businessId, patch.name ?? null, patch.isActive ?? null]);
        return result.rows[0] as DbAccountingAccount | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async createJournalEntry(input: DbJournalEntryCreate): Promise<{ entry: DbJournalEntry; lines: DbJournalLine[] }> {
      try {
        return await ctx.withTransaction(async () => {
          const client = await ctx.client();
          const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
          const accounts = await client.query('SELECT "id" FROM "AccountingAccount" WHERE "businessId"=$1 AND "id"=ANY($2::text[])', [input.businessId, accountIds]);
          if (accounts.rowCount !== accountIds.length) throw new Error("ACCOUNTING_INVALID_ACCOUNT");
          const id = nid("jrn");
          const entryResult = await client.query(
            'INSERT INTO "JournalEntry" ("id","businessId","branchId","sourceType","sourceId","sourceEvent","effectiveAt","currency","description","actorId","requestId","reversesEntryId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
            [id, input.businessId, input.branchId, input.sourceType, input.sourceId, input.sourceEvent, input.effectiveAt, input.currency, input.description, input.actorId, input.requestId, input.reversesEntryId],
          );
          const entry = entryResult.rows[0] as DbJournalEntry;
          const lines: DbJournalLine[] = [];
          for (const [position, line] of input.lines.entries()) {
            const lineResult = await client.query(
              'INSERT INTO "JournalLine" ("id","businessId","entryId","accountId","debitMinor","creditMinor","memo","position") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
              [nid("jln"), input.businessId, entry.id, line.accountId, line.debitMinor, line.creditMinor, line.memo ?? null, position],
            );
            lines.push(...mapLines(lineResult.rows));
          }
          return { entry, lines };
        });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new Error("CONFLICT");
        throw error;
      }
    },
    async findJournalEntryBySource(businessId: string, sourceType: string, sourceId: string, sourceEvent: string): Promise<{ entry: DbJournalEntry; lines: DbJournalLine[] } | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "JournalEntry" WHERE "businessId"=$1 AND "sourceType"=$2 AND "sourceId"=$3 AND "sourceEvent"=$4', [businessId, sourceType, sourceId, sourceEvent]);
        const entry = result.rows[0] as DbJournalEntry | undefined;
        if (!entry) return null;
        const lineResult = await client.query('SELECT * FROM "JournalLine" WHERE "businessId"=$1 AND "entryId"=$2 ORDER BY "position"', [businessId, entry.id]);
        return { entry, lines: mapLines(lineResult.rows) };
      } finally { if (ctx.owns()) client.release(); }
    },
    async findJournalEntryById(id: string, businessId: string): Promise<DbJournalEntry | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "JournalEntry" WHERE "id"=$1 AND "businessId"=$2', [id, businessId]);
        return result.rows[0] as DbJournalEntry | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async listJournalEntries(businessId: string, query: DbJournalPageQuery): Promise<DbJournalEntry[]> {
      const client = await ctx.client();
      try {
        const clauses = ['e."businessId"=$1'];
        const params: unknown[] = [businessId];
        const add = (sql: (n: number) => string, value: unknown): void => { params.push(value); clauses.push(sql(params.length)); };
        if (query.dateFrom) add((n) => `e."effectiveAt">=$${n}`, query.dateFrom);
        if (query.dateTo) add((n) => `e."effectiveAt"<=$${n}`, query.dateTo);
        if (query.branchId === null) clauses.push('e."branchId" IS NULL');
        else if (query.branchId !== undefined) add((n) => `e."branchId"=$${n}`, query.branchId);
        if (query.accountId) add((n) => `EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."businessId"=e."businessId" AND l."entryId"=e."id" AND l."accountId"=$${n})`, query.accountId);
        if (query.after) {
          params.push(query.after.effectiveAt, query.after.id);
          clauses.push(`(e."effectiveAt",e."id")<($${params.length - 1},$${params.length})`);
        }
        params.push(Math.max(1, Math.min(500, query.limit)));
        const result = await client.query(`SELECT e.* FROM "JournalEntry" e WHERE ${clauses.join(" AND ")} ORDER BY e."effectiveAt" DESC,e."id" DESC LIMIT $${params.length}`, params);
        return result.rows as DbJournalEntry[];
      } finally { if (ctx.owns()) client.release(); }
    },
    async listJournalLines(entryId: string, businessId: string): Promise<DbJournalLine[]> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "JournalLine" WHERE "entryId"=$1 AND "businessId"=$2 ORDER BY "position"', [entryId, businessId]);
        return mapLines(result.rows);
      } finally { if (ctx.owns()) client.release(); }
    },
    async aggregateJournalAccountTotals(businessId: string, query: DbJournalTotalsQuery): Promise<DbJournalAccountTotal[]> {
      const client = await ctx.client();
      try {
        const clauses = ['e."businessId"=$1'];
        const params: unknown[] = [businessId];
        const add = (sql: (n: number) => string, value: unknown): void => { params.push(value); clauses.push(sql(params.length)); };
        if (query.dateFrom) add((n) => `e."effectiveAt">=$${n}`, query.dateFrom);
        if (query.dateTo) add((n) => `e."effectiveAt"<$${n}`, query.dateTo);
        if (query.branchId === null) clauses.push('e."branchId" IS NULL');
        else if (query.branchId !== undefined) add((n) => `e."branchId"=$${n}`, query.branchId);
        const result = await client.query(
          `SELECT a.*, COALESCE(SUM(l."debitMinor"),0)::text AS "totalDebitMinor", COALESCE(SUM(l."creditMinor"),0)::text AS "totalCreditMinor" FROM "JournalLine" l JOIN "JournalEntry" e ON e."id"=l."entryId" AND e."businessId"=l."businessId" JOIN "AccountingAccount" a ON a."id"=l."accountId" AND a."businessId"=l."businessId" WHERE ${clauses.join(" AND ")} GROUP BY a."id" ORDER BY a."code"`,
          params,
        );
        return result.rows.map((row) => ({
          account: row as unknown as DbAccountingAccount,
          debitMinor: safeMinor(row["totalDebitMinor"]),
          creditMinor: safeMinor(row["totalCreditMinor"]),
        }));
      } finally { if (ctx.owns()) client.release(); }
    },
    async findAccountingActivation(businessId: string): Promise<DbAccountingActivation | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "AccountingActivation" WHERE "businessId"=$1', [businessId]);
        return result.rows[0] as DbAccountingActivation | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async saveAccountingActivation(input: Omit<DbAccountingActivation, "updatedAt">): Promise<DbAccountingActivation> {
      const client = await ctx.client();
      try {
        const result = await client.query(
          'INSERT INTO "AccountingActivation" ("businessId","status","accountingStartAt","openingEntryId","csvCutoverAt","updatedAt") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT ("businessId") DO UPDATE SET "status"=EXCLUDED."status","accountingStartAt"=EXCLUDED."accountingStartAt","openingEntryId"=EXCLUDED."openingEntryId","csvCutoverAt"=EXCLUDED."csvCutoverAt","updatedAt"=CURRENT_TIMESTAMP RETURNING *',
          [input.businessId, input.status, input.accountingStartAt, input.openingEntryId, input.csvCutoverAt],
        );
        return result.rows[0] as DbAccountingActivation;
      } finally { if (ctx.owns()) client.release(); }
    },
    async createAccountingBackfillRun(input: Omit<DbAccountingBackfillRun, "id" | "createdAt">): Promise<DbAccountingBackfillRun> {
      const client = await ctx.client();
      try {
        const result = await client.query(
          'INSERT INTO "AccountingBackfillRun" ("id","businessId","status","cursor","processedCount","skippedCount","debitMinor","creditMinor","startedAt","completedAt","createdBy","requestId") VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
          [nid("backfill"), input.businessId, input.status, input.cursor ? JSON.stringify(input.cursor) : null, input.processedCount, input.skippedCount, input.debitMinor, input.creditMinor, input.startedAt, input.completedAt, input.createdBy, input.requestId],
        );
        return result.rows[0] as DbAccountingBackfillRun;
      } finally { if (ctx.owns()) client.release(); }
    },
    async findAccountingBackfillRunByRequest(businessId: string, requestId: string): Promise<DbAccountingBackfillRun | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "AccountingBackfillRun" WHERE "businessId"=$1 AND "requestId"=$2', [businessId, requestId]);
        return result.rows[0] as DbAccountingBackfillRun | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async findLatestAccountingBackfillRun(businessId: string): Promise<DbAccountingBackfillRun | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "AccountingBackfillRun" WHERE "businessId"=$1 ORDER BY "createdAt" DESC,"id" DESC LIMIT 1', [businessId]);
        return result.rows[0] as DbAccountingBackfillRun | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async findAccountingBackfillRun(id: string, businessId: string): Promise<DbAccountingBackfillRun | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "AccountingBackfillRun" WHERE "id"=$1 AND "businessId"=$2', [id, businessId]);
        return result.rows[0] as DbAccountingBackfillRun | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async updateAccountingBackfillRun(id: string, businessId: string, patch: Partial<Pick<DbAccountingBackfillRun, "status" | "cursor" | "processedCount" | "skippedCount" | "debitMinor" | "creditMinor" | "startedAt" | "completedAt">>): Promise<DbAccountingBackfillRun | null> {
      const columns: Array<[keyof typeof patch, string]> = [["status", "status"], ["cursor", "cursor"], ["processedCount", "processedCount"], ["skippedCount", "skippedCount"], ["debitMinor", "debitMinor"], ["creditMinor", "creditMinor"], ["startedAt", "startedAt"], ["completedAt", "completedAt"]];
      const updates: string[] = [];
      const values: unknown[] = [id, businessId];
      for (const [key, column] of columns) {
        if (patch[key] === undefined) continue;
        values.push(key === "cursor" && patch.cursor ? JSON.stringify(patch.cursor) : patch[key]);
        updates.push(`"${column}"=$${values.length}${key === "cursor" ? "::jsonb" : ""}`);
      }
      if (!updates.length) throw new Error("ACCOUNTING_BACKFILL_EMPTY_UPDATE");
      const client = await ctx.client();
      try {
        const result = await client.query(`UPDATE "AccountingBackfillRun" SET ${updates.join(",")} WHERE "id"=$1 AND "businessId"=$2 RETURNING *`, values);
        return result.rows[0] as DbAccountingBackfillRun | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async createAccountingBackfillIssue(input: Omit<DbAccountingBackfillIssue, "id" | "createdAt" | "resolvedAt" | "resolvedBy" | "resolutionEntryId" | "resolutionEvidence">): Promise<DbAccountingBackfillIssue> {
      const client = await ctx.client();
      try {
        const result = await client.query(
          'INSERT INTO "AccountingBackfillIssue" ("id","businessId","runId","sourceType","sourceId","reason") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("businessId","sourceType","sourceId","reason") DO UPDATE SET "runId"=EXCLUDED."runId" RETURNING *',
          [nid("backfill-issue"), input.businessId, input.runId, input.sourceType, input.sourceId, input.reason],
        );
        return result.rows[0] as DbAccountingBackfillIssue;
      } finally { if (ctx.owns()) client.release(); }
    },
    async listAccountingBackfillIssues(runId: string, businessId: string, limit: number): Promise<DbAccountingBackfillIssue[]> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "AccountingBackfillIssue" WHERE "businessId"=$1 AND "runId"=$2 ORDER BY "createdAt","id" LIMIT $3', [businessId, runId, Math.max(1, Math.min(200, limit))]);
        return result.rows as DbAccountingBackfillIssue[];
      } finally { if (ctx.owns()) client.release(); }
    },
    async findAccountingBackfillIssue(issueId: string, runId: string, businessId: string): Promise<DbAccountingBackfillIssue | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('SELECT * FROM "AccountingBackfillIssue" WHERE "id"=$1 AND "runId"=$2 AND "businessId"=$3', [issueId,runId,businessId]);
        return result.rows[0] as DbAccountingBackfillIssue | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async countAccountingBackfillIssues(runId: string, businessId: string): Promise<number> {
      const client = await ctx.client();
      try { const result = await client.query('SELECT COUNT(*)::int AS count FROM "AccountingBackfillIssue" WHERE "businessId"=$1 AND "runId"=$2 AND "resolvedAt" IS NULL', [businessId, runId]); return Number(result.rows[0]?.["count"] ?? 0); }
      finally { if (ctx.owns()) client.release(); }
    },
    async resolveAccountingBackfillIssue(input: { issueId: string; runId: string; businessId: string; actorId: string; entryId: string; evidence: string }): Promise<DbAccountingBackfillIssue | null> {
      const client = await ctx.client();
      try {
        const result = await client.query('UPDATE "AccountingBackfillIssue" SET "resolvedAt"=CURRENT_TIMESTAMP,"resolvedBy"=$4,"resolutionEntryId"=$5,"resolutionEvidence"=$6 WHERE "id"=$1 AND "businessId"=$2 AND "runId"=$3 AND "resolvedAt" IS NULL RETURNING *', [input.issueId,input.businessId,input.runId,input.actorId,input.entryId,input.evidence]);
        if (result.rows[0]) return result.rows[0] as DbAccountingBackfillIssue;
        const existing = await client.query('SELECT * FROM "AccountingBackfillIssue" WHERE "id"=$1 AND "businessId"=$2 AND "runId"=$3 AND "resolutionEntryId"=$4', [input.issueId,input.businessId,input.runId,input.entryId]);
        return existing.rows[0] as DbAccountingBackfillIssue | undefined ?? null;
      } finally { if (ctx.owns()) client.release(); }
    },
  };
}

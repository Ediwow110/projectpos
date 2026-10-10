import { describe, expect, it } from "vitest";

import { createMemoryDb } from "./memory.db";
import type { DbIdempotency } from "./db.port";
import { salesFamily } from "./pg/pg-sales";
import type { PgContext } from "./pg/context";

const first: DbIdempotency = {
  businessId: "business-1",
  key: "checkout:mobile",
  commandType: "sale.complete",
  fingerprint: "first-fingerprint",
  resultId: "sale-1",
};

const second: DbIdempotency = {
  businessId: "business-1",
  key: "checkout",
  commandType: "mobile:sale.complete",
  fingerprint: "second-fingerprint",
  resultId: "sale-2",
};

describe("idempotency adapter parity", () => {
  it("memory identifies claims by three distinct fields, not ambiguous delimiter concatenation", async () => {
    const db = createMemoryDb();
    await db.claimIdempotency(first);
    await db.claimIdempotency(second);

    expect(await db.findIdempotency(first.businessId, first.key, first.commandType)).toEqual(first);
    expect(await db.findIdempotency(second.businessId, second.key, second.commandType)).toEqual(second);
    await expect(db.claimIdempotency({ ...first, fingerprint: "changed" }))
      .rejects.toThrow("IDEMPOTENCY_REPLAY");
    expect(await db.findIdempotency("another-business", first.key, first.commandType)).toBeNull();
    expect(await db.findIdempotency(first.businessId, first.key, "different.command")).toBeNull();
  });

  it("PG adapter issues distinct, scoped SQL claims with atomic duplicate handling without opening a database", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const rows = new Map<string, DbIdempotency>();
    const client = {
      query: async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        if (sql.startsWith('INSERT INTO "SaleIdempotency"')) {
          const [, businessId, key, commandType, fingerprint, resultId] = values as string[];
          const tuple = JSON.stringify([businessId, key, commandType]);
          if (rows.has(tuple)) return { rowCount: 0, rows: [] };
          rows.set(tuple, { businessId, key, commandType, fingerprint, resultId });
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM "SaleIdempotency"')) {
          const [businessId, key, commandType] = values as string[];
          const row = rows.get(JSON.stringify([businessId, key, commandType]));
          return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
        }
        throw new Error("Unexpected SQL in isolated parity test");
      },
    };
    const ctx = {
      client: async () => client,
      owns: () => false,
    } as unknown as PgContext;
    const pg = salesFamily(ctx);
    await pg.claimIdempotency(first);
    await pg.claimIdempotency(second);
    expect(await pg.findIdempotency(first.businessId, first.key, first.commandType)).toEqual(first);
    expect(await pg.findIdempotency(second.businessId, second.key, second.commandType)).toEqual(second);
    await expect(pg.claimIdempotency(first)).rejects.toThrow("IDEMPOTENCY_REPLAY");
    expect(await pg.findIdempotency("other-business", first.key, first.commandType)).toBeNull();

    const inserts = queries.filter((row) => row.sql.startsWith('INSERT INTO "SaleIdempotency"'));
    expect(inserts).toHaveLength(3);
    expect(inserts.every((row) => row.sql.includes('ON CONFLICT ("businessId", "key", "commandType") DO NOTHING'))).toBe(true);
    expect(inserts[0]?.values.slice(1, 4)).toEqual([
      first.businessId, first.key, first.commandType,
    ]);
    expect(inserts[1]?.values.slice(1, 4)).toEqual([
      second.businessId, second.key, second.commandType,
    ]);
    expect(queries.some((row) => row.sql.includes('WHERE "businessId" = $1 AND "key" = $2 AND "commandType" = $3'))).toBe(true);
  });
});

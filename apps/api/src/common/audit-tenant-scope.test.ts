import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createMemoryDb } from "./memory.db";
import { auditFamily } from "./pg/pg-audit";
import type { PgContext } from "./pg/context";
import type { AuditEntry } from "./db.port";

const entry = (businessId: string, action: string): AuditEntry => ({
  businessId,
  actorId: "user-1",
  action,
  entityType: "Sale",
  entityId: "sale-1",
  requestId: "req-1",
  at: new Date("2026-10-21T00:00:00.000Z"),
});

/**
 * listAudit advertises an optional businessId. Both adapters must honour it the
 * same way: an in-memory read of every tenant, and a Postgres read that drops
 * the WHERE clause, are the same defect wearing different clothes - and a
 * single-tenant fixture cannot tell them apart from correct scoping.
 */
describe("audit tenant scope parity", () => {
  it("memory returns only the asked-for business when scoped, and everything when not", async () => {
    const db = createMemoryDb();
    await db.appendAudit(entry("business-1", "sale.complete"));
    await db.appendAudit(entry("business-2", "sale.complete"));
    await db.appendAudit(entry("business-1", "refund.request"));

    const scoped = await db.listAudit("business-1");
    expect(scoped).toHaveLength(2);
    expect(scoped.every((row) => row.businessId === "business-1")).toBe(true);

    const all = await db.listAudit();
    expect(all.length, "the unscoped read is kept for whole-store callers").toBeGreaterThan(scoped.length);
  });

  it("postgres binds the tenant into the query instead of loading every business", async () => {
    const sql: Array<{ text: string; params: unknown[] }> = [];
    const client = {
      query: async (text: string, params: unknown[] = []) => {
        sql.push({ text, params });
        return { rows: [] };
      },
      release: () => undefined,
    };
    const ctx = {
      client: async () => client,
      owns: () => true,
    } as unknown as PgContext;

    await auditFamily(ctx).listAudit("business-1");
    await auditFamily(ctx).listAudit();

    expect(sql).toHaveLength(2);
    expect(sql[0]!.text).toContain('WHERE "businessId" = $1');
    expect(sql[0]!.params).toEqual(["business-1"]);
    expect(sql[1]!.text, "an unscoped call stays unscoped").not.toContain("WHERE");
    expect(sql[1]!.params).toEqual([]);
  });

  it("the postgres port wrapper forwards the tenant instead of swallowing it", () => {
    // The regression this pins: listAudit(businessId?) on the port, but
    // `listAudit(): ... this.audit.listAudit()` on the wrapper. Every scoped
    // caller silently became a full cross-tenant table read in production,
    // while memory-backed tests kept passing because the caller filtered after.
    const source = readFileSync(resolve(__dirname, "pg/pg.db.ts"), "utf8");
    const wrapper = source.match(/listAudit\(([^)]*)\)(: Promise<AuditEntry\[\]>)? \{\s*return this\.audit\.listAudit\(([^)]*)\);/);

    expect(wrapper, "listAudit must accept and forward a parameter").not.toBeNull();
    expect(wrapper![1]!, "the wrapper must declare the parameter").toContain("businessId");
    expect(wrapper![3]!, "the wrapper must pass it through").toContain("businessId");
  });
});

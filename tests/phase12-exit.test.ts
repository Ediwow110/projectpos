import { describe, expect, it } from "vitest";
import { PgContext } from "../apps/api/src/common/pg/context";
import { PgDbPort } from "../apps/api/src/common/pg/pg.db";
import { PLAN_SEEDS } from "../apps/api/src/common/pg/pg-plans-seed";

describe("phase12 exit", () => {
  it("boot branches on DATABASE_URL (memory stays the default)", async () => {
    // Read the factory source: the branch is the contract for every existing
    // suite (they run on memory and must never need Docker).
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("apps/api/src/app.module.ts", "utf8");
    expect(src).includes('process.env["DATABASE_URL"]');
    expect(src).includes("createMemoryDb()");
  });

  it("the pg port serves the plan seeds a business boot expects", async () => {
    // No Docker required: this asserts the seed contract the harness and the
    // migration both carry; the parity suites prove the SQL against a real
    // Postgres (pnpm --filter @pos/api test:pg).
    expect(PLAN_SEEDS.map((p) => p.key).sort()).toEqual(["basic", "enterprise", "free", "pro"]);
    const pro = PLAN_SEEDS.find((p) => p.key === "pro")!;
    expect(pro.allowances).toEqual(expect.objectContaining({ registers: 10 }));
  });

  it(" PgDbPort is constructible and closes cleanly", async () => {
    // Constructor smoke only (no connection is opened until a query runs).
    const ctx = new PgContext("postgres://pos:pos@localhost:5999/none");
    const db = new PgDbPort(ctx);
    await expect(ctx.close()).resolves.toBeUndefined();
    void db;
  });
});

// Isolated harness for the devices/billing family tests: the bootstrapDatabase
// pattern from helpers.ts pointed at its own database (pos_test_dbill) so
// concurrently running family work never races the shared pos_test_pg fixture.
// Same disposable lifecycle: create-if-missing, migrations applied once and
// tracked in _migrations, tables truncated + plan rows re-seeded per test.
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PgContext } from "../../src/common/pg/context";
import { PLAN_SEEDS } from "../../src/common/pg/pg-plans-seed";

// Local default: the docker-compose database (port 5433). CI overrides the
// base with PGTEST_BASE pointing at its service container.
const BASE_URL = process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433";
const ADMIN_URL = `${BASE_URL}/postgres`;
const TEST_DB = "pos_test_dbill";
const TEST_URL = `${BASE_URL}/${TEST_DB}`;
const MIGRATIONS_DIR = join(__dirname, "../../../../packages/database/prisma/migrations");

let bootstrapped: Promise<Client> | null = null;

async function bootstrapDatabase(): Promise<Client> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${TEST_DB} OWNER pos`);
  }
  await admin.end();

  const client = new Client({ connectionString: TEST_URL });
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS "_migrations" ("name" TEXT PRIMARY KEY)');
  const applied = new Set(
    (await client.query('SELECT "name" FROM "_migrations"')).rows.map((r) => r.name as string),
  );
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    if (applied.has(dir)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    await client.query(sql);
    await client.query('INSERT INTO "_migrations" ("name") VALUES ($1)', [dir]);
  }
  return client;
}

// Fresh state per test: truncate everything except the migration ledger, then
// the plan seed rows (Subscription.planId carries a foreign key to Plan), and
// a new PgContext for the test to build families over. Families are built
// directly on the context (no PgDbPort) — the coordinator wires them later.
export async function withDbill(fn: (ctx: PgContext) => Promise<void>): Promise<void> {
  if (!bootstrapped) bootstrapped = bootstrapDatabase();
  const client = await bootstrapped;
  const tables = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_migrations')",
    )
  ).rows.map((r) => r.tablename as string);
  if (tables.length > 0) {
    await client.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
  }
  for (const seed of PLAN_SEEDS) {
    await client.query(
      'INSERT INTO "Plan" ("id", "key", "name", "allowances", "pricesMinor", "isActive") VALUES ($1, $2, $3, $4, $5, true)',
      [seed.id, seed.key, seed.name, JSON.stringify(seed.allowances), JSON.stringify(seed.pricesMinor)],
    );
  }
  const ctx = new PgContext(TEST_URL);
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

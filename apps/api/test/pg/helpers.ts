// Phase 12 pg test harness: a disposable database on the docker-compose
// Postgres (docker compose -f docker/docker-compose.yml up -d db), migrations
// applied once and tracked in _migrations, tables truncated between tests.
// File parallelism is off (vitest.pg.config.ts) because tests share the db.
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DbPort } from "../../src/common/db.port";
import { PgContext } from "../../src/common/pg/context";
import { PgDbPort } from "../../src/common/pg/pg.db";
import { PLAN_SEEDS } from "../../src/common/pg/pg-plans-seed";

const ADMIN_URL = "postgres://pos:pos@localhost:5433/postgres";
const TEST_DB = "pos_test_pg";
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

  const client = new Client({ connectionString: `postgres://pos:pos@localhost:5433/${TEST_DB}` });
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

export async function withPg(fn: (db: DbPort, ctx: PgContext) => Promise<void>): Promise<void> {
  if (!bootstrapped) bootstrapped = bootstrapDatabase();
  const client = await bootstrapped;
  // Fresh state per test: everything except the migration ledger, then the
  // plan seed rows every business boot expects.
  const tables = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_migrations')",
    )
  ).rows.map((r) => r.tablename as string);
  await client.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
  for (const seed of PLAN_SEEDS) {
    await client.query(
      'INSERT INTO "Plan" ("id", "key", "name", "allowances", "pricesMinor", "isActive") VALUES ($1, $2, $3, $4, $5, true)',
      [seed.id, seed.key, seed.name, JSON.stringify(seed.allowances), JSON.stringify(seed.pricesMinor)],
    );
  }

  const ctx = new PgContext(`postgres://pos:pos@localhost:5433/${TEST_DB}`);
  // Task 13 turns this into `implements DbPort`; until the last family lands,
  // the cast only covers the families the test actually touches.
  const db = new PgDbPort(ctx) as unknown as DbPort;
  try {
    await fn(db, ctx);
  } finally {
    await ctx.close();
  }
}

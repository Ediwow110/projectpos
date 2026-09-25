// Applies pending migrations 0001..NNNN to the database named by DATABASE_URL,
// tracked in a _migrations table so re-runs are idempotent. Used to prepare
// the e2e database locally and in CI before the API boots on PostgreSQL.
// Usage: DATABASE_URL=postgres://... node scripts/apply-migrations.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../packages/database/prisma/migrations");
const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query('CREATE TABLE IF NOT EXISTS "_migrations" ("name" TEXT PRIMARY KEY)');
const applied = new Set(
  (await client.query('SELECT "name" FROM "_migrations"')).rows.map((r) => r.name),
);
const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let ran = 0;
for (const dir of dirs) {
  if (applied.has(dir)) continue;
  const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
  await client.query(sql);
  await client.query('INSERT INTO "_migrations" ("name") VALUES ($1)', [dir]);
  ran += 1;
  console.log(`applied ${dir}`);
}
console.log(`migrations up to date (${ran} applied, ${dirs.length} total)`);
await client.end();

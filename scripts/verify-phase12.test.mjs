import { existsSync, readFileSync } from "node:fs";
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const checks = [
  existsSync("apps/api/src/common/pg/context.ts"),
  existsSync("apps/api/src/common/pg/pg.db.ts"),
  existsSync("apps/api/src/common/pg/pg-tenants.ts"),
  existsSync("apps/api/src/common/pg/pg-catalog.ts"),
  existsSync("apps/api/src/common/pg/pg-inventory.ts"),
  existsSync("apps/api/src/common/pg/pg-sales.ts"),
  existsSync("apps/api/src/common/pg/pg-shifts.ts"),
  existsSync("apps/api/src/common/pg/pg-people.ts"),
  existsSync("apps/api/src/common/pg/pg-branches.ts"),
  existsSync("apps/api/src/common/pg/pg-devices.ts"),
  existsSync("apps/api/src/common/pg/pg-billing.ts"),
  existsSync("apps/api/src/common/pg/pg-integrations.ts"),
  existsSync("apps/api/src/common/pg/pg-plans-seed.ts"),
  existsSync("apps/api/vitest.pg.config.ts"),
  existsSync("apps/api/test/pg/helpers.ts"),
  existsSync("apps/api/test/pg/pg-two-instance.test.ts"),
  existsSync("packages/database/prisma/migrations/0013_phase12_runtime/migration.sql"),
  existsSync("tests/phase12-exit.test.ts"),
  ci.includes("pg:"),
  ci.includes("vitest.pg.config.ts"),
  ci.includes("PGTEST_BASE"),
  ci.includes("verify-phase12"),
  // The boot branch: DATABASE_URL selects the PostgreSQL store.
  readFileSync("apps/api/src/app.module.ts", "utf8").includes("DATABASE_URL"),
];
if (checks.every(Boolean)) {
  console.log("PHASE12_OK");
} else {
  console.error("PHASE12_MISSING");
  process.exit(1);
}

// Phase 10 migration gate: proves migrations 0001..0011 apply in order to a
// real PostgreSQL 16, including grandfathering a business that already exists
// before Phase 10 (the seed writes a row the file-existence check cannot see).
// Requires a running Docker daemon; exits non-zero with a clear reason
// otherwise.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONTAINER = "pos-db-phase10-verify";
const MIGRATIONS_DIR = "packages/database/prisma/migrations";
const PORT = "5433";

function docker(args, input) {
  return execFileSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function psql(sql) {
  return docker(["exec", "-i", CONTAINER, "psql", "-q", "-t", "-A", "-U", "pos", "-d", "pos"], sql);
}

function psqlStrict(sql) {
  return docker(
    ["exec", "-i", CONTAINER, "psql", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-U", "pos", "-d", "pos"],
    sql,
  );
}

function waitForPostgres() {
  let initComplete = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (!initComplete) {
        initComplete = docker(["logs", CONTAINER]).includes(
          "PostgreSQL init process complete; ready for start up.",
        );
      }
      if (
        initComplete &&
        docker(["exec", CONTAINER, "pg_isready", "-U", "pos", "-d", "pos"]).includes(
          "accepting connections",
        )
      ) {
        return;
      }
    } catch {
      // Not up yet.
    }
    execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 500)"]);
  }
  throw new Error("postgres did not become ready");
}

const work = mkdtempSync(join(tmpdir(), "pos-phase10-"));
let failed = null;
try {
  docker(["rm", "-f", CONTAINER]);
  docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_USER=pos", "-e", "POSTGRES_PASSWORD=pos", "-e", "POSTGRES_DB=pos",
    "-p", `${PORT}:5432`, "postgres:16-alpine",
  ]);
  waitForPostgres();

  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const phase10 = dirs.find((d) => d.startsWith("0011_"));
  if (!phase10) throw new Error("0011 migration directory missing");
  const phase10Index = dirs.indexOf(phase10);

  // This gate intentionally proves the historical 0001 -> 0011 upgrade.
  // Later migrations may depend on tables introduced by 0011, so applying
  // them before the Phase 10 migration would test an impossible ordering.
  for (const dir of dirs.slice(0, phase10Index)) {
    psqlStrict(readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
  }

  // A business that predates Phase 10 must be grandfathered, not dropped.
  psqlStrict(
    `INSERT INTO "Business" ("id", "name", "currency", "updatedAt") VALUES ('biz_legacy', 'Legacy Store', 'PHP', CURRENT_TIMESTAMP);\n`,
  );
  psqlStrict(readFileSync(join(MIGRATIONS_DIR, phase10, "migration.sql"), "utf8"));

  const tables = Number(psql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';\n").trim());
  const plans = Number(psql('SELECT count(*) FROM "Plan";\n').trim());
  const grandfathered = psql(
    'SELECT p."key" FROM "Subscription" s JOIN "Plan" p ON p."id" = s."planId" WHERE s."businessId" = \'biz_legacy\';\n',
  ).trim();
  const indexes = psql(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'FeatureFlag' OR (tablename = 'PrintJob' AND indexname LIKE '%createdAt%') OR (tablename = 'BillingWebhookEvent' AND indexname LIKE '%provider%') OR (tablename = 'Invoice' AND indexname LIKE '%period%');\n",
  );
  // A global feature flag is audited without a tenant, which the audit table
  // only allows because 0011 drops its NOT NULL.
  psqlStrict(
    `INSERT INTO "FeatureFlag" ("id", "businessId", "key", "enabled") VALUES ('flag_global', NULL, 'reports', false);\n` +
      `INSERT INTO "AuditLog" ("id", "businessId", "actorId", "action", "entityType", "entityId", "requestId") VALUES ('aud_global', NULL, 'platform', 'flag.global', 'FeatureFlag', 'reports:false', 'r-global');\n` +
      `INSERT INTO "BillingWebhookEvent" ("id", "provider", "eventId", "type", "payload", "status") VALUES ('whev_1', 'test-double', 'evt-1', 'invoice.paid', '{}'::jsonb, 'applied');\n` +
      `INSERT INTO "BillingWebhookEvent" ("id", "provider", "eventId", "type", "payload", "status") VALUES ('whev_2', 'other', 'evt-1', 'invoice.paid', '{}'::jsonb, 'applied');\n`,
  );
  const globalFlag = psql(`SELECT count(*) FROM "FeatureFlag" WHERE "businessId" IS NULL;\n`).trim();
  const crossProvider = psql(`SELECT count(*) FROM "BillingWebhookEvent" WHERE "eventId" = 'evt-1';\n`).trim();

  const problems = [];
  if (tables !== 40) problems.push(`expected 40 tables, found ${tables}`);
  if (plans !== 4) problems.push(`expected 4 plan seeds, found ${plans}`);
  if (grandfathered !== "enterprise") problems.push(`legacy business plan is "${grandfathered}", expected "enterprise"`);
  if (!indexes.includes("FeatureFlag_global_key_key")) problems.push("missing partial unique index for global feature flags");
  if (!indexes.includes("PrintJob_printerId_createdAt_idx")) problems.push("missing print job FIFO index");
  if (!indexes.includes("BillingWebhookEvent_provider_eventId_key")) problems.push("webhook uniqueness must be (provider, eventId)");
  if (!indexes.includes("Invoice_subscriptionId_period_key")) problems.push("missing invoice period uniqueness index");
  if (globalFlag !== "1") problems.push("global feature flag insert failed");
  if (crossProvider !== "2") problems.push("the same eventId must be allowed across providers");
  if (problems.length > 0) throw new Error(problems.join("; "));
} catch (e) {
  failed = e;
} finally {
  try {
    docker(["rm", "-f", CONTAINER]);
  } catch {
    // Nothing to clean up.
  }
  rmSync(work, { recursive: true, force: true });
}

if (failed) {
  console.error("PHASE10_MIGRATION_FAILED");
  console.error(failed.stderr ? String(failed.stderr) : failed.message);
  process.exit(1);
}
console.log("PHASE10_MIGRATION_OK");

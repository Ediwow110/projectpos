// Phase 11 migration gate: proves migrations 0001..0012 apply in order to a
// real PostgreSQL 16, and that the new surfaces behave: the session's active
// business, the email-verification default, and post-close shift corrections.
// Requires a running Docker daemon; exits non-zero with a clear reason
// otherwise.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONTAINER = "pos-db-phase11-verify";
const MIGRATIONS_DIR = "packages/database/prisma/migrations";
const PORT = "5434";

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
  // The postgres image's initdb starts a temporary server that then shuts
  // down before the real one starts, so pg_isready alone can pass too early:
  // require a SELECT 1 probe to succeed several times in a row.
  let stable = 0;
  for (let attempt = 0; attempt < 120 && stable < 3; attempt++) {
    try {
      if (
        docker(["exec", CONTAINER, "pg_isready", "-U", "pos"]).includes("accepting connections") &&
        docker(["exec", "-i", CONTAINER, "psql", "-q", "-t", "-A", "-U", "pos", "-d", "pos"], "SELECT 1;").trim() === "1"
      ) {
        stable += 1;
      } else {
        stable = 0;
      }
    } catch {
      stable = 0;
    }
    execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 500)"]);
  }
  if (stable < 3) throw new Error("postgres did not become ready");
}

const work = mkdtempSync(join(tmpdir(), "pos-phase11-"));
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
  const phase11 = dirs.find((d) => d.startsWith("0012_"));
  if (!phase11) throw new Error("0012 migration directory missing");

  for (const dir of dirs) {
    psqlStrict(readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
  }

  const tables = Number(psql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';\n").trim());

  // Exercise the new columns and tables the way the runtime will.
  const business = "biz_phase11";
  psqlStrict(
    `INSERT INTO "Business" ("id", "name", "currency", "updatedAt") VALUES ('${business}', 'Phase 11 Store', 'PHP', CURRENT_TIMESTAMP);\n` +
      `INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ('user_p11', 'p11@example.com', 'x', CURRENT_TIMESTAMP);\n` +
      `INSERT INTO "Role" ("id", "businessId", "name") VALUES ('role_p11', '${business}', 'owner');\n` +
      `INSERT INTO "BusinessMembership" ("id", "businessId", "userId", "roleId") VALUES ('mem_p11', '${business}', 'user_p11', 'role_p11');\n` +
      `INSERT INTO "Register" ("id", "businessId", "name", "updatedAt") VALUES ('reg_p11', '${business}', 'Counter 1', CURRENT_TIMESTAMP);\n` +
      `INSERT INTO "Shift" ("id", "businessId", "registerId", "openedBy") VALUES ('shift_p11', '${business}', 'reg_p11', 'user_p11');\n` +
      `UPDATE "Shift" SET "status" = 'CLOSED', "closedAt" = CURRENT_TIMESTAMP, "closedBy" = 'user_p11' WHERE "id" = 'shift_p11';\n`,
  );

  // Active business persisted on the session; NULL falls back to the home one.
  psqlStrict(
      `INSERT INTO "Session" ("id", "userId", "businessId", "tokenHash", "expiresAt", "revokedAt") VALUES ('sess_p11', 'user_p11', '${business}', 'tok_p11', CURRENT_TIMESTAMP + INTERVAL '1 day', NULL);\n` +
      `UPDATE "Session" SET "activeBusinessId" = '${business}' WHERE "id" = 'sess_p11';\n`,
  );
  const activeBusiness = psql(`SELECT "activeBusinessId" FROM "Session" WHERE "id" = 'sess_p11';\n`).trim();

  // New users default to verified (flag off), and corrections append cleanly.
  const emailVerified = psql(`SELECT "emailVerified" FROM "User" WHERE "id" = 'user_p11';\n`).trim();
  psqlStrict(
    `INSERT INTO "ShiftCorrection" ("id", "businessId", "shiftId", "amountMinor", "reason", "actorId", "requestId") VALUES ('shcor_p11', '${business}', 'shift_p11', -500, 'counted before last drop', 'user_p11', 'r-1');\n` +
      `INSERT INTO "ReceiptShare" ("id", "businessId", "saleId", "tokenHash", "expiresAt") VALUES ('rsh_p11', '${business}', 'sale_none', 'hash_p11', CURRENT_TIMESTAMP + INTERVAL '1 day');\n`,
  );
  const corrections = Number(psql(`SELECT count(*) FROM "ShiftCorrection" WHERE "shiftId" = 'shift_p11';\n`).trim());
  const corrected = psql(
    `SELECT s."expectedCashMinor" + COALESCE(SUM(c."amountMinor"), 0) FROM "Shift" s LEFT JOIN "ShiftCorrection" c ON c."shiftId" = s."id" WHERE s."id" = 'shift_p11' GROUP BY s."expectedCashMinor";\n`,
  ).trim();

  const problems = [];
  if (tables !== 45) problems.push(`expected 45 tables, found ${tables}`);
  if (activeBusiness !== business) problems.push(`session active business is "${activeBusiness}", expected "${business}"`);
  if (!["t", "true"].includes(emailVerified)) problems.push(`emailVerified default is "${emailVerified}", expected "true"`);
  if (corrections !== 1) problems.push(`expected 1 correction, found ${corrections}`);
  if (corrected !== "-500") problems.push(`corrected expected cash is "${corrected}", expected "-500"`);
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
  console.error("PHASE11_MIGRATION_FAILED");
  console.error(failed.stderr ? String(failed.stderr) : failed.message);
  process.exit(1);
}
console.log("PHASE11_MIGRATION_OK");

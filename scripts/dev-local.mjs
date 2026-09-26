import { spawn, spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const dockerCompose = ["compose", "-f", "docker/docker-compose.yml", "up", "-d", "db"];
const devDatabase = "pos_dev";
const adminUrl = "postgres://pos:pos@localhost:5433/postgres";
const usingDefaultDatabase = !process.env.DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL ?? `postgres://pos:pos@localhost:5433/${devDatabase}`;

function fail(message) {
  console.error(message);
  console.error("Run `pnpm dev:memory` if you intentionally want the disposable in-memory database.");
  process.exit(1);
}

if (usingDefaultDatabase) {
  const docker = spawnSync("docker", dockerCompose, { stdio: "inherit" });
  if (docker.error || docker.status !== 0) {
    fail("Could not start the local PostgreSQL container.");
  }

  let admin = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      admin = new Client({ connectionString: adminUrl });
      await admin.connect();
      break;
    } catch {
      if (admin) await admin.end().catch(() => undefined);
      admin = null;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!admin) fail("Local PostgreSQL did not become ready in time.");

  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [devDatabase]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${devDatabase}`);
      console.log(`created local database ${devDatabase}`);
    }
  } finally {
    await admin.end();
  }
}

const migrate = spawnSync(process.execPath, ["scripts/apply-migrations.mjs"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
});
if (migrate.error || migrate.status !== 0) fail("Local database migrations failed.");

const displayUrl = databaseUrl.replace(/:[^:@/]+@/, ":***@");
console.log(`starting NexPOS with persistent PostgreSQL (${displayUrl})`);

const child = process.platform === "win32"
  ? spawn("cmd.exe", ["/d", "/s", "/c", "pnpm turbo run dev"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    })
  : spawn("pnpm", ["turbo", "run", "dev"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

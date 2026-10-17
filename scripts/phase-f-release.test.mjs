import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("API boot never executes database migrations", () => {
  const dockerfile = read("docker/api.Dockerfile");
  const command = dockerfile.match(/^CMD\s+(.+)$/m)?.[1];
  assert.ok(command, "API image needs an explicit startup command");
  assert.doesNotMatch(command, /migrat/i);
  assert.match(command, /node/);
  assert.match(command, /src\/main\.ts/);
});

test("Render Free releases require operator-controlled deployments and encryption key", () => {
  const blueprint = read("render.yaml");
  assert.equal((blueprint.match(/^\s+autoDeployTrigger:\s+'off'$/gm) ?? []).length, 2);
  assert.match(blueprint, /- key: APPROVAL_QUEUE_ENCRYPTION_KEY\s+sync: false/);
  assert.doesNotMatch(blueprint, /^\s+preDeployCommand:/m);
  assert.doesNotMatch(blueprint, /^\s+autoDeploy:\s+true/m);
});

test("compose has a separate migration dependency and requires approval key", () => {
  const compose = read("docker/production-compose.example.yml");
  assert.match(compose, /migrate:\s+build:/);
  assert.match(compose, /migrate:\s+condition: service_completed_successfully/);
  assert.match(compose, /APPROVAL_QUEUE_ENCRYPTION_KEY:\s+\$\{APPROVAL_QUEUE_ENCRYPTION_KEY:\?/);
});

test("new tenant tables have RLS enabled", () => {
  const definitions = [
    ["0036_customer_concerns", ["CustomerConcern"]],
    ["0037_manager_approval_requests", ["ManagerApprovalRequest"]],
    ["0038_stock_exceptions", ["StockException"]],
    ["0039_phase_d_support", ["GuestSupportCase", "PlatformOwnerConsent"]],
  ];
  for (const [directory, tables] of definitions) {
    const sql = read(`packages/database/prisma/migrations/${directory}/migration.sql`);
    for (const table of tables) {
      assert.ok(sql.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`), `${table} must enable RLS`);
    }
  }
});

test("H5 notification outbox migration is tenant-scoped and remains opt-in", () => {
  const sql = read("packages/database/prisma/migrations/0049_order_notification_outbox/migration.sql");
  const env = read(".env.example");
  assert.match(sql, /FOREIGN KEY \("businessId", "orderId"\) REFERENCES "Order" \("businessId", "id"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "OrderNotificationOutbox_business_dedupe_key"/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY|ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /"email"|"token"|"tokenHash"|"providerError"/);
  assert.match(env, /^ORDER_NOTIFICATION_OUTBOX_ENABLED=false$/m);
  assert.doesNotMatch(read("docker/api.Dockerfile"), /ORDER_NOTIFICATION_OUTBOX_ENABLED=true/);
});

test("production startup fails before listening when approval key is absent", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: join(root, "apps/api"),
    env: { ...process.env, NODE_ENV: "production", APPROVAL_QUEUE_ENCRYPTION_KEY: "" },
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, `API startup could not be checked: ${result.error?.message}`);
  assert.notEqual(result.status, 0, "missing key must prevent successful startup");
  assert.match(`${result.stderr}${result.stdout}`, /APPROVAL_QUEUE_ENCRYPTION_KEY_INVALID/);
});

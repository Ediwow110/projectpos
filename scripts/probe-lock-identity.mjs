// Identifies WHICH advisory lock the growth-mix waiters block on: samples
// pg_locks/pg_stat_activity mid-mix and matches objid against hashtext() of
// every lock key the complete path can take.
import { Client } from "pg";
import { spawn } from "node:child_process";

const DB = "postgres://pos:pos@localhost:5433/pos_load";
const pg = new Client({ connectionString: DB });
await pg.connect();

// Spawn the mix FIRST, wait for its registration, THEN read the business id —
// the previous version hashed the previous run's business and matched nothing.
const mix = spawn("node", ["scripts/load/dashboard-mix.mjs", "--base", "http://localhost:3003", "--concurrency", "50", "--duration", "20", "--catalog", "100"], { cwd: "G:/Vscode/POS" });
await new Promise((r) => setTimeout(r, 4000));
const biz = (await pg.query('SELECT "id" FROM "Business" ORDER BY "createdAt" DESC LIMIT 1')).rows[0].id;
const keys = [`sales:${biz}`, `rate-limit:${biz}:complete`, `billing:${biz}`, `refunds:${biz}`, `register:${biz}`];
const keyByHash = new Map();
for (const k of keys) {
  const h = (await pg.query("SELECT hashtext($1)::bigint AS h", [k])).rows[0].h;
  keyByHash.set(String(h), k);
}
console.log("business:", biz);

const waitCounts = new Map();
let maxWaiting = 0;
const end = Date.now() + 9000;
while (Date.now() < end) {
  const waiting = await pg.query(
    "SELECT l.objid::bigint AS objid, count(*)::int AS n FROM pg_locks l WHERE l.locktype = 'advisory' AND NOT l.granted GROUP BY 1 ORDER BY 2 DESC LIMIT 5",
  );
  const held = await pg.query(
    "SELECT l.objid::bigint AS objid, count(*)::int AS n FROM pg_locks l WHERE l.locktype = 'advisory' AND l.granted GROUP BY 1 ORDER BY 2 DESC LIMIT 5",
  );
  for (const row of waiting.rows) {
    const k = keyByHash.get(String(row.objid)) ?? `unknown(${row.objid})`;
    waitCounts.set(k, Math.max(waitCounts.get(k) ?? 0, row.n));
    maxWaiting = Math.max(maxWaiting, row.n);
  }
  void held;
  await new Promise((r) => setTimeout(r, 80));
}
console.log("max simultaneous advisory WAITERS on one key:", maxWaiting);
for (const [k, n] of [...waitCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: up to ${n} waiting`);
mix.kill();
await pg.end();

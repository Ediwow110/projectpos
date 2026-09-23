// Online POS load mix (HTTP mode, zero dependencies, Node 24+).
// Targets any running API base URL: local server runs and staging.
// Usage:
//   node scripts/load/dashboard-mix.mjs --base http://localhost:3001 \
//     --email owner@load.test --password correct-horse-12 \
//     --concurrency 5 --duration 60 --catalog 50
//
// Mix per worker: 50% product search, 20% sale complete (unique keys),
// 20% dashboard overview, 10% sales list. Prints p50/p95/p99 per operation,
// throughput, error rate, and budget verdicts. Exits non-zero on any budget
// breach or error rate above 1%.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? ""]);
    return acc;
  }, []),
);

const BASE = args["base"] ?? "http://localhost:3001";
const EMAIL = args["email"] ?? `owner-load-${Date.now()}@load.test`;
const PASSWORD = args["password"] ?? "correct-horse-12";
const CONCURRENCY = Number(args["concurrency"] ?? 5);
const DURATION_SECS = Number(args["duration"] ?? 60);
const CATALOG = Number(args["catalog"] ?? 50);

const BUDGETS = {
  search: 200,
  complete: 500,
  overview: 1000,
  list: 500,
};

const lat = { search: [], complete: [], overview: [], list: [] };
let errors = 0;
let total = 0;

function jar() {
  let cookies = "";
  return {
    headers() {
      return cookies === "" ? {} : { Cookie: cookies };
    },
    store(res) {
      const set = res.headers.getSetCookie?.() ?? [];
      const parts = set.map((c) => String(c).split(";")[0]).filter(Boolean);
      if (parts.length > 0) cookies = parts.join("; ");
    },
  };
}

async function timed(op, fn) {
  const start = performance.now();
  total += 1;
  try {
    await fn();
    lat[op].push(performance.now() - start);
  } catch {
    errors += 1;
  }
}

async function setup() {
  const j = jar();
  const post = async (path, body, extra = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...j.headers(), ...(extra.headers ?? {}) },
      body: JSON.stringify(body),
    });
    j.store(res);
    const data = await res.json().catch(() => ({}));
    return { res, data, jar: j };
  };
  const reg = await post("/api/v1/auth/register", {
    ownerName: "Load",
    email: EMAIL,
    password: PASSWORD,
    businessName: "Load Store",
  });
  if (reg.res.status !== 201) throw new Error(`register failed: ${reg.res.status}`);
  let csrf = reg.data.csrfToken;
  const authed = async (path, body, headers) => {
    const out = await post(path, body, { headers });
    if (out.data.csrfToken) csrf = out.data.csrfToken;
    return { ...out, csrf };
  };
  const ids = [];
  for (let i = 0; i < CATALOG; i += 1) {
    const p = await authed("/api/v1/products", { name: `Load-${i}`, priceMinor: 1000 + i }, { "X-CSRF-Token": csrf });
    ids.push(p.data.id);
    await authed("/api/v1/inventory/movements", { productId: p.data.id, type: "opening_stock", qtyDelta: 100000 }, { "X-CSRF-Token": csrf });
  }
  return { jar: j, getCsrf: () => csrf, setCsrf: (v) => { csrf = v; }, productIds: ids };
}

async function worker(ctx, deadline) {
  const { jar: j, productIds } = ctx;
  let n = 0;
  const get = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: j.headers() });
    j.store(res);
    await res.text();
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  };
  const post = async (path, body, key) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...j.headers(), "X-CSRF-Token": ctx.getCsrf(), ...(key ? { "Idempotency-Key": key } : {}) },
      body: JSON.stringify(body),
    });
    j.store(res);
    const data = await res.json().catch(() => ({}));
    if (data.csrfToken) ctx.setCsrf(data.csrfToken);
    if (!res.ok && res.status !== 202) throw new Error(`POST ${path}: ${res.status}`);
    return data;
  };
  while (Date.now() < deadline) {
    n += 1;
    const roll = Math.random();
    const pick = productIds[n % productIds.length];
    if (roll < 0.5) {
      await timed("search", () => get(`/api/v1/products?q=Load&page=1&pageSize=20`));
    } else if (roll < 0.7) {
      await timed("complete", async () => {
        const draft = await post("/api/v1/sales/drafts", { lines: [{ productId: pick, qty: 1 }] });
        await post("/api/v1/sales/complete", { saleId: draft.id, payments: [{ method: "cash", amountMinor: draft.totalMinor }] }, `load-${Date.now()}-${n}-${Math.random()}`);
      });
    } else if (roll < 0.9) {
      await timed("overview", () => get("/api/v1/dashboard/overview?compare=none"));
    } else {
      await timed("list", () => get("/api/v1/sales?limit=20"));
    }
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const ctx = await setup();
const deadline = Date.now() + DURATION_SECS * 1000;
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(ctx, deadline)));

let breach = false;
for (const op of ["search", "complete", "overview", "list"]) {
  const sorted = [...lat[op]].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const ok = p95 <= BUDGETS[op];
  if (!ok) breach = true;
  console.log(
    `${op}: n=${sorted.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms budget=${BUDGETS[op]}ms ${ok ? "PASS" : "BREACH"}`,
  );
}
const errRate = total === 0 ? 0 : (errors / total) * 100;
console.log(`total=${total} errors=${errors} errRate=${errRate.toFixed(2)}%`);
if (errRate > 1) breach = true;
process.exit(breach ? 1 : 0);

// Phase 21 production-shaped HTTP mix. No secrets or request payloads are
// printed. Example:
// BASE_URL=https://staging.example DURATION_SECS=60 CONCURRENCY=10 \
//   OUTPUT_PATH=phase21-load.json node scripts/load/phase21-mix.mjs
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function classifyFailure(error) {
  if (error?.name === "AbortError") return "timeout";
  if (typeof error?.status === "number") return error.status >= 500 ? "server_error" : "http_error";
  return "transport_error";
}

export function redactSample(value) {
  return String(value).slice(0, 160)
    .replace(/https?:\/\/[^\s]+/gi, "[URL]")
    .replace(/(password|secret|token|cookie|authorization|key)[^\s:=]*\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cookieFrom(response) {
  const cookies = response.headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function request(base, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${base}${path}`, { ...options, signal: controller.signal, headers: { ...(options.headers ?? {}) } });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {}; }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function authenticate(base) {
  const email = process.env.PHASE21_LOAD_EMAIL ?? `phase21-load-${Date.now()}@load.invalid`;
  const password = process.env.PHASE21_LOAD_PASSWORD ?? `phase21-${Date.now()}-secret`;
  let response = await fetch(`${base}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerName: "Load", email, password, businessName: `Phase21 Load ${Date.now()}` }) });
  let body = await response.json().catch(() => ({}));
  if (!response.ok) {
    response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    body = await response.json().catch(() => ({}));
  }
  if (!response.ok) throw new Error("authentication failed");
  return { cookie: cookieFrom(response), csrf: body.csrfToken };
}

export async function runLoad({ baseUrl = process.env.BASE_URL ?? "http://localhost:3001", durationMs = envNumber("DURATION_SECS", 30) * 1000, concurrency = envNumber("CONCURRENCY", 5), outputPath = process.env.OUTPUT_PATH ?? "phase21-load.json" } = {}) {
  const base = baseUrl.replace(/\/$/, "");
  const auth = await authenticate(base);
  const headers = { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf };
  const seed = await request(base, "/api/v1/products", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name: `Phase21 Load ${Date.now()}`, sku: `PHASE21-${Date.now()}`, barcode: `PHASE21-BC-${Date.now()}`, priceMinor: 100, costMinor: 10 }) });
  const productId = seed.body.id;
  await request(base, "/api/v1/inventory/movements", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ productId, type: "opening_stock", qtyDelta: 100000 }) });
  const completeSale = async () => {
    const draft = await request(base, "/api/v1/sales/drafts", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ lines: [{ productId, qty: 1 }] }) });
    return request(base, "/api/v1/sales/complete", { method: "POST", headers: { ...headers, "content-type": "application/json", "Idempotency-Key": `phase21-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] }) });
  };
  const operations = {
    product_search: () => request(base, "/api/v1/products?q=Phase21&page=1&pageSize=20", { headers }),
    barcode_lookup: () => request(base, `/api/v1/products/barcode/${encodeURIComponent(seed.body.barcode)}`, { headers }),
    reports: () => request(base, "/api/v1/dashboard/overview?compare=none", { headers }),
    inventory: () => request(base, `/api/v1/inventory/products/${productId}/movements`, { headers }),
    procurement: () => request(base, "/api/v1/suppliers", { headers }),
    customer_lookup: () => request(base, "/api/v1/customers?q=load", { headers }),
    stored_value: () => request(base, "/api/v1/gift-cards", { headers }),
    pos_completion: completeSale,
    receipts: async () => { const completed = await completeSale(); return request(base, `/api/v1/receipts/${completed.body.id}/download`, { headers }); },
  };
  const latencies = Object.fromEntries(Object.keys(operations).map((name) => [name, []]));
  const failures = Object.fromEntries(Object.keys(operations).map((name) => [name, 0]));
  const samples = [];
  let total = 0;
  const deadline = Date.now() + durationMs;
  async function worker(seedN) {
    let n = seedN;
    while (Date.now() < deadline) {
      const names = Object.keys(operations);
      const name = names[n++ % names.length];
      const started = performance.now(); total += 1;
      try { await operations[name](); latencies[name].push(performance.now() - started); }
      catch (error) { failures[name] += 1; if (samples.length < 10) samples.push({ operation: name, class: classifyFailure(error), detail: redactSample(error?.message ?? error) }); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
  const result = { generatedAt: new Date().toISOString(), baseUrl: base, durationMs, concurrency, total, failures, operations: Object.fromEntries(Object.entries(latencies).map(([name, values]) => [name, { count: values.length, p50Ms: percentile(values, 50), p95Ms: percentile(values, 95), p99Ms: percentile(values, 99), throughputPerSecond: values.length / Math.max(durationMs / 1000, 1) }])), samples };
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const result = await runLoad();
  console.log(`Phase 21 load complete: ${result.total} requests; report written to ${process.env.OUTPUT_PATH ?? "phase21-load.json"}`);
}

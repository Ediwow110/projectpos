// Phase 22 disposable omnichannel load cohort. This reports local/staging
// latency only; never describe these numbers as production latency.
//
// Example:
// BASE_URL=http://localhost:3001 WEB_ORIGIN=http://localhost:3000 \
//   DURATION_SECS=20 CONCURRENCY=4 OUTPUT_PATH=phase22-orders-load.json \
//   node scripts/load/phase22-orders.mjs
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function errorRate(count, failures) {
  return count <= 0 ? 0 : failures / count;
}

export function redactSample(value) {
  return String(value).slice(0, 200)
    .replace(/https?:\/\/[^\s]+/gi, "[URL]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[REDACTED_PHONE]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[REDACTED_SECRET]")
    .replace(/(password|secret|token|cookie|authorization|key)[^\s:=]*\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cookieFrom(response) {
  const rows = response.headers.getSetCookie?.()
    ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  return rows.map((row) => row.split(";", 1)[0]).join("; ");
}

async function request(base, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetch(base + path, {
      ...options,
      signal: controller.signal,
      headers: { ...(options.headers ?? {}) },
    });
    const text = await response.text();
    let body = {};
    if (text) {
      try { body = JSON.parse(text); } catch { body = {}; }
    }
    if (!response.ok) {
      const error = new Error("HTTP " + response.status);
      error.status = response.status;
      throw error;
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function seed(base, origin) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const email = "phase22-load-" + stamp + "@load.invalid";
  const password = "phase22-" + stamp + "-secret";
  const registration = await request(base, "/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerName: "Phase22 Load", email, password, businessName: "Phase22 Load " + stamp }),
  });
  const cookie = cookieFrom(registration.response);
  const csrf = registration.body.csrfToken;
  const authHeaders = { Cookie: cookie, "X-CSRF-Token": csrf, "content-type": "application/json" };
  const branch = await request(base, "/api/v1/branches", {
    method: "POST", headers: authHeaders, body: JSON.stringify({ name: "Load Branch" }),
  });
  const product = await request(base, "/api/v1/products", {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ name: "Phase22 Load Product " + stamp, sku: "P22-" + stamp, priceMinor: 100, costMinor: 10 }),
  });
  await request(base, "/api/v1/inventory/movements", {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ productId: product.body.id, branchId: branch.body.id, type: "opening_stock", qtyDelta: 100000 }),
  });
  await request(base, "/api/v1/business/settings", {
    method: "PATCH", headers: authHeaders,
    body: JSON.stringify({
      onlineOrderingEnabled: true,
      onlinePickupBranchIds: [branch.body.id],
      onlineFulfillmentBranchId: branch.body.id,
      deliveryFlatFeeMinor: 0,
    }),
  });
  const business = await request(base, "/api/v1/business", { headers: { Cookie: cookie } });
  const storefrontKey = business.body.storefrontKey;

  async function submitOrder(prefix) {
    const create = await request(base, "/api/v1/public/orders", {
      method: "POST",
      headers: { Origin: origin, "content-type": "application/json", "Idempotency-Key": prefix + ":create" },
      body: JSON.stringify({ storefrontKey }),
    });
    const checkout = cookieFrom(create.response);
    await request(base, "/api/v1/public/orders/" + encodeURIComponent(create.body.id) + "/draft", {
      method: "PATCH",
      headers: { Origin: origin, Cookie: checkout, "content-type": "application/json" },
      body: JSON.stringify({ branchId: branch.body.id, fulfillmentMode: "PICKUP", lines: [{ productId: product.body.id, qty: 1 }] }),
    });
    return request(base, "/api/v1/public/orders/" + encodeURIComponent(create.body.id) + "/submit", {
      method: "POST",
      headers: { Origin: origin, Cookie: checkout, "content-type": "application/json", "Idempotency-Key": prefix + ":submit" },
      body: JSON.stringify({
        branchId: branch.body.id,
        fulfillmentMode: "PICKUP",
        paymentMode: "PAY_AT_PICKUP",
        contactName: "Load Guest",
        email: "guest-" + stamp + "@load.invalid",
        phone: "+639170000000",
      }),
    });
  }

  const statusSeed = await submitOrder("status-seed-" + stamp);
  return {
    authHeaders,
    branchId: branch.body.id,
    productId: product.body.id,
    storefrontKey,
    statusToken: statusSeed.body.statusToken,
    submitOrder,
  };
}

export function summarize(latencies, failures) {
  return Object.fromEntries(Object.entries(latencies).map(([name, values]) => {
    const fail = failures[name] ?? 0;
    const total = values.length + fail;
    return [name, {
      count: total,
      successCount: values.length,
      failures: fail,
      errorRate: errorRate(total, fail),
      p50Ms: percentile(values, 50),
      p95Ms: percentile(values, 95),
      p99Ms: percentile(values, 99),
    }];
  }));
}

export async function runLoad({
  baseUrl = process.env.BASE_URL ?? "http://localhost:3001",
  webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000",
  durationMs = envNumber("DURATION_SECS", 20) * 1000,
  concurrency = envNumber("CONCURRENCY", 4),
  outputPath = process.env.OUTPUT_PATH ?? "phase22-orders-load.json",
} = {}) {
  const base = baseUrl.replace(/\/$/, "");
  const seeded = await seed(base, webOrigin);
  let seq = 0;
  const operations = {
    public_catalog: () => request(
      base,
      "/api/v1/public/storefront/catalog?key=" + encodeURIComponent(seeded.storefrontKey)
        + "&branchId=" + encodeURIComponent(seeded.branchId)
        + "&page=1&pageSize=20",
    ),
    submit_hold: () => seeded.submitOrder("load-" + Date.now() + "-" + seq++),
    staff_list: () => request(base, "/api/v1/orders?limit=25", { headers: { Cookie: seeded.authHeaders.Cookie } }),
    status_lookup: () => request(base, "/api/v1/public/orders/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: seeded.statusToken }),
    }),
  };
  const latencies = Object.fromEntries(Object.keys(operations).map((name) => [name, []]));
  const failures = Object.fromEntries(Object.keys(operations).map((name) => [name, 0]));
  const samples = [];
  let total = 0;
  const deadline = Date.now() + durationMs;

  async function worker(workerIndex) {
    let index = workerIndex;
    while (Date.now() < deadline) {
      const names = Object.keys(operations);
      const name = names[index++ % names.length];
      const started = performance.now();
      total += 1;
      try {
        await operations[name]();
        latencies[name].push(performance.now() - started);
      } catch (error) {
        failures[name] += 1;
        if (samples.length < 10) samples.push({
          operation: name,
          class: error?.name === "AbortError" ? "timeout" : typeof error?.status === "number" ? "http_error" : "transport_error",
          detail: redactSample(error?.message ?? error),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
  const result = {
    generatedAt: new Date().toISOString(),
    environment: "local_or_staging_disposable",
    productionLatencyClaim: false,
    durationMs,
    concurrency,
    total,
    operations: summarize(latencies, failures),
    samples,
  };
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLoad();
  console.log("Phase 22 disposable load cohort complete: " + result.total + " operations; local/staging latency only.");
}

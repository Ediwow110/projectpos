// Load cohorts (opt-in): this file matches the default `vitest run` glob but
// both tests no-op unless explicitly enabled, keeping `pnpm test` fast:
//   LOAD=1 pnpm --filter @pos/api exec vitest run test/load-cohort.test.ts
//   LOAD=1 LOAD_GROWTH=1 pnpm --filter @pos/api exec vitest run test/load-cohort.test.ts
// Measures app-stack latency (excludes TCP + Postgres — those are covered
// by running scripts/load/dashboard-mix.mjs against a live server/staging).
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

const BUDGETS: Record<string, number> = { search: 200, complete: 500, overview: 1000, list: 500 };

let app: INestApplication;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function seed(catalog: number): Promise<{ cookie: string; csrf: string; productIds: string[] }> {
  const jar = (h: unknown): string => {
    const arr = Array.isArray(h) ? h : [String(h ?? "")];
    return arr.map((c) => String(c).split(";")[0]).join("; ");
  };
  const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Load", email: `load-${Date.now()}@test.xx`,
    password: "correct-horse-12", businessName: "Load Store",
  });
  let cookie = jar(reg.headers["set-cookie"]);
  const csrf = reg.body.csrfToken as string;
  const productIds: string[] = [];
  for (let i = 0; i < catalog; i += 1) {
    const p = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ name: `Load-${i}`, priceMinor: 1000 + i });
    productIds.push(p.body.id as string);
    await request(app.getHttpServer()).post("/api/v1/inventory/movements")
      .set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ productId: p.body.id, type: "opening_stock", qtyDelta: 100000 });
  }
  return { cookie, csrf, productIds };
}

async function runMix(
  cookie: string,
  csrf: string,
  productIds: string[],
  concurrency: number,
  durationMs: number,
): Promise<{ lat: Record<string, number[]>; errors: number; total: number; samples: string[] }> {
  const lat: Record<string, number[]> = { search: [], complete: [], overview: [], list: [] };
  let errors = 0;
  let total = 0;
  let lastCompleteAt = 0;
  let paceTail: Promise<void> = Promise.resolve();
  const samples: string[] = [];
  const timed = async (op: string, fn: () => Promise<void>): Promise<void> => {
    const start = performance.now();
    total += 1;
    try {
      await fn();
      lat[op].push(performance.now() - start);
    } catch (e) {
      // One retry on a localhost ECONNRESET: the reads are idempotent and
      // complete carries an idempotency key, so a reset mid-churn is a
      // transport artifact, not an application error. Only a second
      // consecutive failure counts.
      if (e instanceof Error && e.message.includes("ECONNRESET")) {
        try {
          await fn();
          lat[op].push(performance.now() - start);
          return;
        } catch (e2) {
          errors += 1;
          if (samples.length < 10) samples.push(`${op}: ${e2 instanceof Error ? e2.message.slice(0, 160) : String(e2).slice(0, 160)}`);
          return;
        }
      }
      errors += 1;
      if (samples.length < 10) samples.push(`${op}: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}`);
    }
  };
  const worker = async (seedN: number): Promise<void> => {
    const deadline = Date.now() + durationMs;
    let n = seedN;
    // Pace cash completions to realistic cashier throughput (~8/s shared
    // across workers → ~480/min, under the 1000/min abuse brake) so the
    // mix measures app latency instead of tripping the limiter. Decisions
    // are mutex-serialized: without this, N workers read the same stale
    // timestamp and fire together. The pacing wait happens OUTSIDE timed()
    // and is never counted as latency.
    const paceComplete = async (): Promise<void> => {
      const prev = paceTail;
      let release!: () => void;
      paceTail = new Promise<void>((r) => {
        release = r;
      });
      await prev;
      try {
        const wait = 125 - (Date.now() - lastCompleteAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastCompleteAt = Date.now();
      } finally {
        release();
      }
    };
    while (Date.now() < deadline) {
      n += 1;
      const roll = ((n * 2654435761) % 1000) / 1000;
      const pick = productIds[n % productIds.length];
      if (roll < 0.5) {
        await timed("search", async () => {
          const r = await request(app.getHttpServer()).get("/api/v1/products?q=Load&page=1&pageSize=20").set("Cookie", cookie);
          if (r.status !== 200) throw new Error(`search ${r.status}`);
        });
      } else if (roll < 0.7) {
        await paceComplete();
        await timed("complete", async () => {
          const draft = await request(app.getHttpServer()).post("/api/v1/sales/drafts")
            .set("Cookie", cookie).set("X-CSRF-Token", csrf)
            .send({ lines: [{ productId: pick, qty: 1 }] });
          const done = await request(app.getHttpServer()).post("/api/v1/sales/complete")
            .set("Cookie", cookie).set("X-CSRF-Token", csrf)
            .set("Idempotency-Key", `load-${Date.now()}-${n}-${seedN}`)
            .send({ saleId: draft.body.id, payments: [{ method: "cash", amountMinor: draft.body.totalMinor }] });
          if (done.status !== 201 && done.status !== 202) throw new Error(`complete ${done.status}`);
        });
      } else if (roll < 0.9) {
        await timed("overview", async () => {
          const r = await request(app.getHttpServer()).get("/api/v1/dashboard/overview?compare=none").set("Cookie", cookie);
          if (r.status !== 200) throw new Error(`overview ${r.status}`);
        });
      } else {
        await timed("list", async () => {
          const r = await request(app.getHttpServer()).get("/api/v1/sales?limit=20").set("Cookie", cookie);
          if (r.status !== 200) throw new Error(`list ${r.status}`);
        });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i * 7919)));
  return { lat, errors, total, samples };
}

function report(name: string, lat: Record<string, number[]>, errors: number, total: number, samples: string[] = []): void {
  console.log(`--- ${name} ---`);
  for (const op of ["search", "complete", "overview", "list"]) {
    const sorted = [...lat[op]].sort((a, b) => a - b);
    console.log(
      `${op}: n=${sorted.length} p50=${percentile(sorted, 50).toFixed(1)}ms p95=${percentile(sorted, 95).toFixed(1)}ms p99=${percentile(sorted, 99).toFixed(1)}ms budget=${BUDGETS[op]}ms`,
    );
  }
  console.log(`total=${total} errors=${errors}`);
  for (const s of samples) console.log(`  sample: ${s}`);
}

describe("phase8 load cohorts", () => {
  // Fresh app per test: isolates rate-limiter windows and databases
  // between cohorts so each measurement stands alone.
  it("baseline cohort stays within budgets", async () => {
    app = await createTestApp();
    try {
      if (process.env["LOAD"] !== "1") {
        console.log("skipping baseline cohort (set LOAD=1 to run)");
        expect(true).toBe(true);
        return;
      }
      const { cookie, csrf, productIds } = await seed(50);
    const { lat, errors, total, samples } = await runMix(cookie, csrf, productIds, 5, 15_000);
    report("baseline", lat, errors, total, samples);
    // Error budget: ≤1% (transport flakes under socket churn, e.g. a lone
    // ECONNRESET, must not fail an otherwise green cohort).
    expect((errors / Math.max(total, 1)) * 100).toBeLessThanOrEqual(1);
      for (const op of ["search", "complete", "overview", "list"]) {
        const sorted = [...lat[op]].sort((a, b) => a - b);
        expect(percentile(sorted, 95)).toBeLessThanOrEqual(BUDGETS[op]);
      }
    } finally {
      await app.close();
    }
  }, 120_000);

  it("growth cohort stays within budgets", async () => {
    if (process.env["LOAD_GROWTH"] !== "1") {
      console.log("skipping growth cohort (set LOAD_GROWTH=1 to run)");
      expect(true).toBe(true);
      return;
    }
    app = await createTestApp();
    try {
      const { cookie, csrf, productIds } = await seed(500);
    const { lat, errors, total, samples } = await runMix(cookie, csrf, productIds, 50, 60_000);
    report("growth", lat, errors, total, samples);
    expect((errors / Math.max(total, 1)) * 100).toBeLessThanOrEqual(1);
      for (const op of ["search", "complete", "overview", "list"]) {
        const sorted = [...lat[op]].sort((a, b) => a - b);
        expect(percentile(sorted, 95)).toBeLessThanOrEqual(BUDGETS[op]);
      }
    } finally {
      await app.close();
    }
  }, 300_000);
});

// Phase 12 exit proof (PLAN 6.4/6.5, the compliance audit's core objection):
// two separate pool connections — i.e. two app instances — race the same
// invariants, and the database, not the process, decides the winner.
import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PgContext } from "../../src/common/pg/context";
import { PgDbPort } from "../../src/common/pg/pg.db";
import { PLAN_SEEDS } from "../../src/common/pg/pg-plans-seed";
import type { DbPort } from "../../src/common/db.port";

const BASE = process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433";
const TEST_DB = process.env["PGTEST_DB"] ?? "pos_test_pg";
const URL = `${BASE}/${TEST_DB}`;
const MIGRATIONS_DIR = join(__dirname, "../../../../packages/database/prisma/migrations");

async function resetSharedDb(): Promise<void> {
  const admin = new Client({ connectionString: `${BASE}/postgres` });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${TEST_DB.replace(/"/g, '""')}" OWNER pos`);
  await admin.end();
  const client = new Client({ connectionString: URL });
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS "_migrations" ("name" TEXT PRIMARY KEY)');
  const applied = new Set(
    (await client.query('SELECT "name" FROM "_migrations"')).rows.map((r) => r.name as string),
  );
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    if (applied.has(dir)) continue;
    await client.query(readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
    await client.query('INSERT INTO "_migrations" ("name") VALUES ($1)', [dir]);
  }
  const tables = (
    await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_migrations')")
  ).rows.map((r) => r.tablename as string);
  await client.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
  for (const seed of PLAN_SEEDS) {
    await client.query(
      'INSERT INTO "Plan" ("id", "key", "name", "allowances", "pricesMinor", "isActive") VALUES ($1, $2, $3, $4, $5, true)',
      [seed.id, seed.key, seed.name, JSON.stringify(seed.allowances), JSON.stringify(seed.pricesMinor)],
    );
  }
  await client.end();
}

async function withTwoPorts(fn: (a: DbPort, b: DbPort, ctxA: PgContext, ctxB: PgContext) => Promise<void>): Promise<void> {
  const ctxA = new PgContext(URL);
  const ctxB = new PgContext(URL);
  const a = new PgDbPort(ctxA) as unknown as DbPort;
  const b = new PgDbPort(ctxB) as unknown as DbPort;
  try {
    await fn(a, b, ctxA, ctxB);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
}

describe("phase12 two-instance concurrency proof", () => {
  it("races the same last unit across two Order reservations: exactly one HELD row wins", async () => {
    await resetSharedDb();
    await withTwoPorts(async (a, b) => {
      const { ReservationService } = await import("../../src/orders/reservation-service");
      const biz = await a.createBusiness({ name: "Reservation Race", currency: "PHP" });
      const branch = await a.createBranch({ businessId: biz.id, name: "Main", type: "store", isActive: true });
      const product = await a.createProduct({
        businessId: biz.id, categoryId: null, name: "Last Unit", sku: "RACE-LAST", barcode: null,
        brand: null, unit: "pc", costMinor: 100, priceMinor: 500, taxRateBps: null,
        reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
      });
      await a.upsertBalance({ businessId: biz.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
      const makeOrder = async (db: DbPort, suffix: string) => {
        const now = new Date("2026-10-06T12:00:00.000Z");
        const order = await db.createOrder({
          businessId: biz.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
          branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
          deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 500, discountMinor: 0,
          taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 500, saleId: null, status: "SUBMITTED",
          version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
          actorId: "public", requestId: "reservation-race-" + suffix, createdAt: now, updatedAt: now,
        });
        await db.createOrderLine({
          businessId: biz.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
          sku: product.sku, barcode: null, unit: product.unit, qty: 1, priceMinor: 500, costMinor: 100,
          taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 500, bundleComponentsSnapshot: null,
          createdAt: now,
        });
        return order;
      };
      const orderA = await makeOrder(a, "a");
      const orderB = await makeOrder(b, "b");
      const serviceA = new ReservationService(a);
      const serviceB = new ReservationService(b);
      const results = await Promise.allSettled([
        serviceA.holdSubmittedOrder(biz.id, orderA.id, "hold-a", new Date("2026-10-06T12:00:00.000Z")),
        serviceB.holdSubmittedOrder(biz.id, orderB.id, "hold-b", new Date("2026-10-06T12:00:00.000Z")),
      ]);
      expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
      expect((results.find((row) => row.status === "rejected") as PromiseRejectedResult).reason.message)
        .toBe("RESERVATION_CONFLICT");
      const held = [
        ...(await a.listReservationsByOrder(orderA.id, biz.id)),
        ...(await a.listReservationsByOrder(orderB.id, biz.id)),
      ].filter((row) => row.status === "HELD");
      expect(held).toHaveLength(1);
      expect((await a.findBalance(product.id, biz.id, branch.id))?.qtyOnHand).toBe(1);
    });
  });

  it("races the last unit of stock across two instances: exactly one sale wins", async () => {
    await resetSharedDb();
    await withTwoPorts(async (a, b) => {
      const { SalesService } = await import("../../src/sales/nest/sales.service");
      // Real parent rows: Postgres enforces the FKs memory never had.
      const biz = await a.createBusiness({ name: "Race Store", currency: "PHP" });
      await a.createRegister({ businessId: biz.id, name: "Counter 1", isActive: true, branchId: null });
      const product = await a.createProduct({
        businessId: biz.id, categoryId: null, name: "Last Unit", sku: null, barcode: null,
        brand: null, unit: "pc", costMinor: 100, priceMinor: 500, taxRateBps: null,
        reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
      });
      // Opening stock via the ledger (the balance follows from it, exactly
      // as the inventory service does it — the ledger invariant is the point).
      await a.createMovement({
        businessId: biz.id, productId: product.id, type: "opening_stock", qtyDelta: 1,
        reason: null, referenceType: null, referenceId: null, actorId: "u1", requestId: "r-open",
      });
      await a.upsertBalance({ businessId: biz.id, productId: product.id, qtyOnHand: 1 });

      const salesA = new SalesService(a);
      const salesB = new SalesService(b);
      // Both instances prepare a draft, then complete concurrently. Service
      // code is identical to the memory path — only the port differs.
      const draftA = await salesA.createDraft(biz.id, "u1", "r1", {
        lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
      }, []);
      const draftB = await salesB.createDraft(biz.id, "u2", "r1", {
        lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
      }, []);

      const results = await Promise.allSettled([
        salesA.completeSale(biz.id, "u1", "rA", draftA.id, {
          payments: [{ method: "cash", amountMinor: draftA.totalMinor }], key: `race-a-${Date.now()}`, granted: [],
        }),
        salesB.completeSale(biz.id, "u2", "rB", draftB.id, {
          payments: [{ method: "cash", amountMinor: draftB.totalMinor }], key: `race-b-${Date.now()}`, granted: [],
        }),
      ]);
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
      expect((lost[0] as PromiseRejectedResult).reason.message).toBe("INSUFFICIENT_STOCK");

      // The ledger invariant holds across the race: balance equals the ledger
      // sum, exactly one sale completed, exactly one cash movement.
      const balance = await a.findBalance(product.id, biz.id);
      expect(balance!.qtyOnHand).toBe(0);
      const movements = await a.listMovements(product.id, biz.id);
      expect(movements.reduce((s, m) => s + m.qtyDelta, 0)).toBe(0); // +1 opening, -1 sale
      const winner = (won[0] as PromiseFulfilledResult<{ sale: { id: string } }>).value.sale;
      const payments = await a.listPaymentsBySale(winner.id, biz.id);
      expect(payments).toHaveLength(1);
    });
  });

  it("races one idempotency key across two instances: exactly one claim", async () => {
    await resetSharedDb();
    await withTwoPorts(async (a, b) => {
      const biz = await a.createBusiness({ name: "Claim Store", currency: "PHP" });
      const key = `two-instance-${Date.now()}`;
      const claim = (db: DbPort) => db.claimIdempotency({
        businessId: biz.id, key, commandType: "sale.complete", fingerprint: "fp", resultId: "sale_1",
      });
      const [x, y] = await Promise.allSettled([claim(a), claim(b)]);
      // Exactly one instance claims the key; the loser gets memory's replay
      // error. Which instance wins is not deterministic.
      const won = [x, y].filter((r) => r.status === "fulfilled");
      const lost = [x, y].filter((r) => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason.message).toBe("IDEMPOTENCY_REPLAY");
    });
  });

  it("races one webhook eventId across two instances: exactly one claim", async () => {
    await resetSharedDb();
    await withTwoPorts(async (a, b) => {
      const e = { businessId: null, provider: "test-double", eventId: `evt-${Date.now()}`, type: "invoice.paid", payload: {}, status: "processing" };
      const [x, y] = await Promise.allSettled([
        a.claimWebhookEvent(e),
        b.claimWebhookEvent(e),
      ]);
      // Port semantics: the winner gets the row, the loser gets null (the
      // billing service turns that into WEBHOOK_IN_PROGRESS for the provider).
      // Which instance wins is not deterministic.
      expect(x.status).toBe("fulfilled");
      expect(y.status).toBe("fulfilled");
      const values = [x, y].map((r) => (r as PromiseFulfilledResult<unknown>).value);
      expect(values.filter((v) => v !== null)).toHaveLength(1);
      expect(values.filter((v) => v === null)).toHaveLength(1);
    });
  });
});

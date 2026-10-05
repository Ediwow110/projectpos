import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PgContext } from "../../src/common/pg/context";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { catalogFamily } from "../../src/common/pg/pg-catalog";
import { salesFamily } from "../../src/common/pg/pg-sales";
import type { DbProduct, DbSale } from "../../src/common/db.port";

// Sales-family tests: the family runs directly over a fresh PgContext (no
// PgDbPort), mirroring the memory store's behavior — same tenant filters, same
// insertion ordering, null for missing/cross-tenant rows, [] for empty lists,
// IDEMPOTENCY_REPLAY on a duplicate idempotency claim. Same disposable
// database as helpers.ts; PGTEST_BASE lets CI point at its own container.
const URL = `${process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433"}/${process.env["PGTEST_DB"] ?? "pos_test_pg"}`;
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let admin: Client;
let ctx: PgContext;
let sales: ReturnType<typeof salesFamily>;
let tenants: ReturnType<typeof tenantsFamily>;
let catalog: ReturnType<typeof catalogFamily>;

beforeAll(async () => {
  admin = new Client({ connectionString: URL });
  await admin.connect();
});

beforeEach(async () => {
  // Fresh state per test: truncate everything except the migration ledger,
  // exactly like helpers.ts.
  const tables = (
    await admin.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_migrations')",
    )
  ).rows.map((r) => r.tablename as string);
  if (tables.length > 0) {
    await admin.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
  }
  ctx = new PgContext(URL);
  sales = salesFamily(ctx);
  tenants = tenantsFamily(ctx);
  catalog = catalogFamily(ctx);
});

afterEach(async () => {
  await ctx.close();
});

afterAll(async () => {
  await admin.end();
});

async function seedBusiness() {
  return tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
}

async function seedProduct(businessId: string, name: string): Promise<DbProduct> {
  return catalog.createProduct({
    businessId,
    categoryId: null,
    name,
    sku: uniq("sku"),
    barcode: null,
    brand: null,
    unit: "pcs",
    costMinor: 500,
    priceMinor: 1000,
    taxRateBps: 1200,
    reorderLevel: 0,
    trackInventory: true,
    isActive: true,
    imageUrl: null,
  }) as Promise<DbProduct>;
}

// Every runtime field filled, nullable ones explicit — the create contract.
function fullSale(businessId: string, receiptNo: string, overrides: Partial<DbSale> = {}) {
  return {
    businessId,
    receiptNo,
    status: "DRAFT",
    subtotalMinor: 1000,
    discountMinor: 0,
    taxMinor: 120,
    deliveryFeeMinor: 100,
    deliveryTaxMinor: 12,
    totalMinor: 1120,
    paidMinor: 0,
    changeMinor: 0,
    currency: "PHP",
    customerId: null,
    customerName: null,
    notes: null,
    actorId: uniq("user"),
    requestId: uniq("req"),
    idempotencyKey: null,
    registerId: null,
    branchId: null,
    voidedAt: null,
    voidReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("phase12 pg sales: sales", () => {
  it("creates a sale (completedAt defaults to null) and finds it by id", async () => {
    const b = await seedBusiness();
    const created = await sales.createSale(
      fullSale(b.id, uniq("rcpt"), { registerId: "reg_1", branchId: "br_1" }),
    );
    expect(created.id).toBeTruthy();
    expect(created.completedAt ?? null).toBeNull();
    expect(await sales.findSaleById(created.id, b.id)).toEqual(created);
  });

  it("round-trips every nullable sale field as null and honors a caller-provided completedAt", async () => {
    const b = await seedBusiness();
    const completedAt = new Date("2026-09-25T10:00:00Z");
    const created = await sales.createSale(fullSale(b.id, uniq("rcpt"), { completedAt }));
    expect(await sales.findSaleById(created.id, b.id)).toEqual(created);
    expect(await sales.findSaleById(created.id, b.id)).toEqual({ ...created });
    expect(created.deliveryFeeMinor).toBe(100);
    expect(created.deliveryTaxMinor).toBe(12);
  });

  it("partial-updates a sale and stamps the completion fields together", async () => {
    const b = await seedBusiness();
    const s = await sales.createSale(fullSale(b.id, uniq("rcpt")));
    const completedAt = new Date();
    const done = await sales.updateSale(s.id, b.id, {
      status: "COMPLETED",
      paidMinor: 1120,
      changeMinor: 0,
      completedAt,
      idempotencyKey: uniq("idem"),
    });
    expect(done).toEqual({
      ...s,
      status: "COMPLETED",
      paidMinor: 1120,
      changeMinor: 0,
      completedAt,
      idempotencyKey: done!.idempotencyKey,
    });
    // Absent keys unchanged, verified through an independent read.
    expect(await sales.findSaleById(s.id, b.id)).toEqual(done);
    // A null in the patch clears the column (service clears branch on voids).
    const cleared = await sales.updateSale(s.id, b.id, { branchId: null, customerId: null });
    expect(cleared).toEqual({ ...done, branchId: null, customerId: null });
  });

  it("round-trips the persisted void timestamp and trimmed reason fields", async () => {
    const b = await seedBusiness();
    const s = await sales.createSale(fullSale(b.id, uniq("rcpt")));
    const voidedAt = new Date("2026-10-06T10:00:00.000Z");
    const voided = await sales.updateSale(s.id, b.id, {
      status: "VOIDED",
      voidedAt,
      voidReason: "Duplicate draft",
    });

    expect(voided).toEqual({ ...s, status: "VOIDED", voidedAt, voidReason: "Duplicate draft" });
    expect(await sales.findSaleById(s.id, b.id)).toEqual(voided);
  });

  it("returns null for missing or cross-tenant sales on find and update", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const s = await sales.createSale(fullSale(b2.id, uniq("rcpt")));
    expect(await sales.findSaleById(s.id, b1.id)).toBeNull();
    expect(await sales.findSaleById("sale_none", b1.id)).toBeNull();
    expect(await sales.updateSale(s.id, b1.id, { status: "VOIDED" })).toBeNull();
    expect(await sales.updateSale("sale_none", b1.id, { status: "VOIDED" })).toBeNull();
  });

  it("lists only the business's sales in insertion order; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const s1 = await sales.createSale(fullSale(b1.id, uniq("rcpt")));
    await sleep(2); // keep createdAt strictly increasing (TIMESTAMP(3) granularity)
    await sales.createSale(fullSale(b2.id, uniq("rcpt")));
    await sleep(2);
    const s3 = await sales.createSale(fullSale(b1.id, uniq("rcpt")));
    const rows = await sales.listSalesByBusiness(b1.id);
    expect(rows.map((r) => r.id)).toEqual([s1.id, s3.id]);
    expect(await sales.listSalesByBusiness("biz_empty")).toEqual([]);
  });

  it("pages sales by id cursor like listMovementsPage", async () => {
    const b = await seedBusiness();
    const s1 = await sales.createSale(fullSale(b.id, uniq("rcpt")));
    const s2 = await sales.createSale(fullSale(b.id, uniq("rcpt")));
    const s3 = await sales.createSale(fullSale(b.id, uniq("rcpt")));
    expect((await sales.listSalesPage(b.id, null, 10)).map((r) => r.id)).toEqual([s1.id, s2.id, s3.id]);
    expect((await sales.listSalesPage(b.id, s1.id, 10)).map((r) => r.id)).toEqual([s2.id, s3.id]);
    expect((await sales.listSalesPage(b.id, s1.id, 1)).map((r) => r.id)).toEqual([s2.id]);
    expect(await sales.listSalesPage(b.id, s3.id, 10)).toEqual([]);
    expect(await sales.listSalesPage("biz_none", null, 10)).toEqual([]);
  });

  it("findLatestSaleForRegister returns the newest COMPLETED sale of that register only", async () => {
    const b = await seedBusiness();
    const older = await sales.createSale(
      fullSale(b.id, uniq("rcpt"), { registerId: "reg_1", status: "COMPLETED", createdAt: new Date(Date.now() - 5000) }),
    );
    await sleep(2);
    const newest = await sales.createSale(
      fullSale(b.id, uniq("rcpt"), { registerId: "reg_1", status: "COMPLETED" }),
    );
    // A draft and another register's sale must be ignored.
    await sales.createSale(fullSale(b.id, uniq("rcpt"), { registerId: "reg_1", status: "DRAFT" }));
    await sales.createSale(fullSale(b.id, uniq("rcpt"), { registerId: "reg_2", status: "COMPLETED" }));
    const b2 = await seedBusiness();
    await sales.createSale(fullSale(b2.id, uniq("rcpt"), { registerId: "reg_1", status: "COMPLETED" }));
    expect((await sales.findLatestSaleForRegister(b.id, "reg_1"))!.id).toBe(newest.id);
    expect((await sales.findLatestSaleForRegister(b.id, "reg_1"))!.id).not.toBe(older.id);
    expect(await sales.findLatestSaleForRegister(b.id, "reg_none")).toBeNull();
  });
});

describe("phase12 pg sales: sale items", () => {
  it("lists sale items by explicit cashier position instead of generated id order", async () => {
    const b = await seedBusiness();
    const p = await seedProduct(b.id, "Ordering product");
    const sale = await sales.createSale(fullSale(b.id, uniq("rcpt")));

    const later = await sales.createSaleItem({
      businessId: b.id,
      saleId: sale.id,
      position: 1,
      productId: p.id,
      name: "Apple Juice",
      unit: "pcs",
      qty: 1,
      priceMinor: 1000,
      costMinor: 500,
      taxRateBps: null,
      lineDiscountMinor: 0,
      lineTotalMinor: 1000,
    });
    const earlier = await sales.createSaleItem({
      businessId: b.id,
      saleId: sale.id,
      position: 0,
      productId: p.id,
      name: "Zebra Water",
      unit: "pcs",
      qty: 1,
      priceMinor: 1000,
      costMinor: 500,
      taxRateBps: null,
      lineDiscountMinor: 0,
      lineTotalMinor: 1000,
    });

    expect((await sales.listSaleItems(sale.id, b.id)).map((item) => item.id)).toEqual([
      earlier.id,
      later.id,
    ]);
  });

  it("creates sale items and lists them for their sale only", async () => {
    const b = await seedBusiness();
    const p = await seedProduct(b.id, "Cola");
    const s1 = await sales.createSale(fullSale(b.id, uniq("rcpt")));
    await sleep(2);
    const s2 = await sales.createSale(fullSale(b.id, uniq("rcpt")));
    const i1 = await sales.createSaleItem({
      businessId: b.id,
      saleId: s1.id,
      productId: p.id,
      name: "Cola",
      unit: "pcs",
      qty: 2,
      priceMinor: 1000,
      costMinor: 500,
      taxRateBps: 1200,
      lineDiscountMinor: 0,
      lineTotalMinor: 2000,
    });
    const i2 = await sales.createSaleItem({
      businessId: b.id,
      saleId: s2.id,
      productId: p.id,
      name: "Cola",
      unit: "pcs",
      qty: 1,
      priceMinor: 1000,
      costMinor: 500,
      taxRateBps: null,
      lineDiscountMinor: 100,
      lineTotalMinor: 900,
    });
    expect(i1.id).toBeTruthy();
    const forS1 = await sales.listSaleItems(s1.id, b.id);
    expect(forS1.map((i) => i.id)).toEqual([i1.id]);
    expect(forS1[0].taxRateBps).toBe(1200);
    expect((await sales.listSaleItems(s2.id, b.id)).map((i) => i.id)).toEqual([i2.id]);
    expect(await sales.listSaleItems(s1.id, "biz_other")).toEqual([]);
    expect(await sales.listSaleItems("sale_none", b.id)).toEqual([]);
  });
});

describe("phase12 pg sales: payments", () => {
  it("creates a payment and finds it by id; cross-tenant -> null", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const s = await sales.createSale(fullSale(b1.id, uniq("rcpt")));
    const p = await sales.createPayment({
      businessId: b1.id,
      saleId: s.id,
      method: "CASH",
      amountMinor: 1120,
      status: "SUCCEEDED",
      providerRef: null,
      idempotencyKey: uniq("pay"),
    });
    expect(p.id).toBeTruthy();
    expect(await sales.findPaymentById(p.id, b1.id)).toEqual(p);
    expect(await sales.findPaymentById(p.id, b2.id)).toBeNull();
    expect(await sales.findPaymentById("pay_none", b1.id)).toBeNull();
  });

  it("lists payments by sale in insertion order; other sales and tenants excluded", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const s1 = await sales.createSale(fullSale(b1.id, uniq("rcpt")));
    await sleep(2);
    const s2 = await sales.createSale(fullSale(b1.id, uniq("rcpt")));
    const p1 = await sales.createPayment({
      businessId: b1.id, saleId: s1.id, method: "CASH", amountMinor: 500,
      status: "SUCCEEDED", providerRef: null, idempotencyKey: uniq("pay"),
    });
    await sleep(2);
    const p2 = await sales.createPayment({
      businessId: b1.id, saleId: s1.id, method: "CARD", amountMinor: 620,
      status: "SUCCEEDED", providerRef: "pr_1", idempotencyKey: uniq("pay"),
    });
    await sales.createPayment({
      businessId: b1.id, saleId: s2.id, method: "CASH", amountMinor: 1120,
      status: "SUCCEEDED", providerRef: null, idempotencyKey: uniq("pay"),
    });
    await sales.createPayment({
      businessId: b2.id, saleId: s1.id, method: "CASH", amountMinor: 1120,
      status: "SUCCEEDED", providerRef: null, idempotencyKey: uniq("pay"),
    });
    expect((await sales.listPaymentsBySale(s1.id, b1.id)).map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(await sales.listPaymentsBySale(s1.id, "biz_other")).toEqual([]);
  });

  it("partial-updates a payment (status flips) and returns null cross-tenant", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const s = await sales.createSale(fullSale(b1.id, uniq("rcpt")));
    const p = await sales.createPayment({
      businessId: b1.id, saleId: s.id, method: "GCASH", amountMinor: 1120,
      status: "UNKNOWN", providerRef: null, idempotencyKey: uniq("pay"),
    });
    const confirmed = await sales.updatePayment(p.id, b1.id, { status: "SUCCEEDED", providerRef: "pr_9" });
    expect(confirmed).toEqual({ ...p, status: "SUCCEEDED", providerRef: "pr_9" });
    expect(await sales.findPaymentById(p.id, b1.id)).toEqual(confirmed);
    expect(await sales.updatePayment(p.id, b2.id, { status: "FAILED" })).toBeNull();
    expect(await sales.updatePayment("pay_none", b1.id, { status: "FAILED" })).toBeNull();
  });
});

describe("phase12 pg sales: idempotency", () => {
  it("claims once; a replay with the same key throws IDEMPOTENCY_REPLAY and never duplicates", async () => {
    const b = await seedBusiness();
    const r = {
      businessId: b.id,
      key: uniq("idem"),
      commandType: "sale.complete",
      fingerprint: "fp1",
      resultId: "sale_1",
    };
    await sales.claimIdempotency(r);
    expect(await sales.findIdempotency(b.id, r.key, r.commandType)).toEqual(r);
    await expect(sales.claimIdempotency({ ...r, resultId: "sale_2" })).rejects.toThrow("IDEMPOTENCY_REPLAY");
    // Exactly one row, still the winner's.
    const count = await admin.query(
      'SELECT COUNT(*)::int AS n FROM "SaleIdempotency" WHERE "businessId" = $1 AND "key" = $2',
      [b.id, r.key],
    );
    expect(count.rows[0].n).toBe(1);
    expect((await sales.findIdempotency(b.id, r.key, r.commandType))!.resultId).toBe("sale_1");
  });

  it("keeps claims apart by key and commandType; misses return null", async () => {
    const b = await seedBusiness();
    const key = uniq("idem");
    await sales.claimIdempotency({ businessId: b.id, key, commandType: "sale.complete", fingerprint: "fp", resultId: "sale_a" });
    // Same key, different commandType: a separate claim under the
    // (businessId, key, commandType) arbiter — both succeed.
    await sales.claimIdempotency({ businessId: b.id, key, commandType: "refund.approve", fingerprint: "fp", resultId: "sale_b" });
    expect((await sales.findIdempotency(b.id, key, "sale.complete"))!.resultId).toBe("sale_a");
    expect((await sales.findIdempotency(b.id, key, "refund.approve"))!.resultId).toBe("sale_b");
    expect(await sales.findIdempotency(b.id, key, "sale.void")).toBeNull();
    expect(await sales.findIdempotency("biz_none", key, "sale.complete")).toBeNull();
    const count = await admin.query('SELECT COUNT(*)::int AS n FROM "SaleIdempotency" WHERE "businessId" = $1', [b.id]);
    expect(count.rows[0].n).toBe(2);
  });
});

describe("phase12 pg sales: held sales", () => {
  it("saves, lists per actor, marks resumed, and finds held sales; cross-tenant -> null", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const actor = uniq("user");
    const payload = { items: [{ productId: "prod_1", qty: 2 }], note: "parked" };
    const h1 = await sales.createHeldSale({ businessId: b1.id, actorId: actor, payload, resumedAt: null });
    await sleep(2);
    const h2 = await sales.createHeldSale({ businessId: b1.id, actorId: uniq("user"), payload: { items: [] }, resumedAt: null });
    await sales.createHeldSale({ businessId: b2.id, actorId: actor, payload: { items: [] }, resumedAt: null });
    expect(h1.id).toBeTruthy();
    expect(await sales.findHeldSaleById(h1.id, b1.id)).toEqual(h1);
    // JSONB payload round-trips as the same object, no stringifying.
    expect(await sales.findHeldSaleById(h1.id, b1.id)).toEqual({ ...h1 });
    expect(await sales.findHeldSaleById(h1.id, b2.id)).toBeNull();
    const mine = await sales.listHeldSales(b1.id, actor);
    expect(mine.map((h) => h.id)).toEqual([h1.id]);
    expect(await sales.listHeldSales(b1.id, "user_none")).toEqual([]);
    await sales.markHeldResumed(h2.id, b1.id);
    expect((await sales.findHeldSaleById(h2.id, b1.id))!.resumedAt).not.toBeNull();
    await sales.markHeldResumed(h2.id, b2.id); // cross-tenant: ignored
    expect((await sales.findHeldSaleById(h2.id, b1.id))!.resumedAt).not.toBeNull();
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PgContext } from "../../src/common/pg/context";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { inventoryFamily } from "../../src/common/pg/pg-inventory";
import type { DbMovement } from "../../src/common/db.port";

// Inventory-family parity tests against the memory store's behavior: same
// filters, same branch null-sensitivity (undefined = all rows, null = exactly
// the head-office NULL-branch rows, value = that branch), same id-cursor
// paging, same cross-tenant null/[] returns. Direct PgContext construction —
// no withPg/PgDbPort; the coordinator wires families into the facade later.
const BASE_URL = process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433";
const TEST_URL = `${BASE_URL}/pos_test_pg`;
const MIGRATIONS_DIR = join(__dirname, "../../../../packages/database/prisma/migrations");

let admin: Client;

beforeAll(async () => {
  admin = new Client({ connectionString: TEST_URL });
  await admin.connect();
  // Same one-time migration replay as helpers.ts, so this file also works
  // when run standalone (it must not depend on withPg having bootstrapped).
  await admin.query('CREATE TABLE IF NOT EXISTS "_migrations" ("name" TEXT PRIMARY KEY)');
  const applied = new Set(
    (await admin.query('SELECT "name" FROM "_migrations"')).rows.map((r) => r.name as string),
  );
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    if (applied.has(dir)) continue;
    await admin.query(readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
    await admin.query('INSERT INTO "_migrations" ("name") VALUES ($1)', [dir]);
  }
});

afterAll(async () => {
  await admin.end();
});

beforeEach(async () => {
  // Fresh state per test: everything except the migration ledger.
  const tables = (
    await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_migrations')")
  ).rows.map((r) => r.tablename as string);
  if (tables.length > 0) {
    await admin.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
  }
});

async function withInventory(
  fn: (inv: ReturnType<typeof inventoryFamily>, ctx: PgContext) => Promise<void>,
): Promise<void> {
  const ctx = new PgContext(TEST_URL);
  try {
    await fn(inventoryFamily(ctx), ctx);
  } finally {
    await ctx.close();
  }
}

const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seedBusiness(ctx: PgContext) {
  // Parent rows (business) come from the tenants family, like production.
  return tenantsFamily(ctx).createBusiness({ name: uniq("Biz"), currency: "PHP" });
}

async function seedProduct(ctx: PgContext, businessId: string): Promise<string> {
  // InventoryBalance/InventoryMovement carry FKs to Product; the catalog
  // family is a separate task, so seed the parent product row directly.
  const c = await ctx.client();
  try {
    const id = uniq("prod");
    await c.query(
      'INSERT INTO "Product" ("id", "businessId", "name", "priceMinor", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [id, businessId, "Coke", 250],
    );
    return id;
  } finally {
    if (ctx.owns()) c.release();
  }
}

function movementInput(businessId: string, productId: string, over: Partial<Omit<DbMovement, "id">> = {}): Omit<DbMovement, "id"> {
  return {
    businessId,
    productId,
    type: "receive",
    qtyDelta: 5,
    reason: null,
    referenceType: null,
    referenceId: null,
    actorId: "u1",
    requestId: uniq("req"),
    branchId: null,
    ...over,
  };
}

const byId = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("phase12 pg inventory: movements", () => {
  it("createMovement returns the row and listMovements scopes it to the product+business", async () => {
    await withInventory(async (inv, ctx) => {
      const b1 = await seedBusiness(ctx);
      const b2 = await seedBusiness(ctx);
      const p1 = await seedProduct(ctx, b1.id);
      const input = movementInput(b1.id, p1, { qtyDelta: 10 });
      const created = await inv.createMovement(input);
      expect(created.id).toBeTruthy();
      expect(created).toEqual({ ...input, id: created.id });
      expect((await inv.listMovements(p1, b1.id)).map((m) => m.id)).toEqual([created.id]);
      // Wrong business: nothing (cross-tenant reads return [], never throw).
      expect(await inv.listMovements(p1, b2.id)).toEqual([]);
      const p2 = await seedProduct(ctx, b1.id);
      expect(await inv.listMovements(p2, b1.id)).toEqual([]);
    });
  });

  it("listMovements branch modes: undefined = all rows, null = head-office only, value = that branch only", async () => {
    await withInventory(async (inv, ctx) => {
      const b = await seedBusiness(ctx);
      const p = await seedProduct(ctx, b.id);
      const head = await inv.createMovement(movementInput(b.id, p, { branchId: null }));
      const br1 = await inv.createMovement(movementInput(b.id, p, { branchId: "br1" }));
      const br2 = await inv.createMovement(movementInput(b.id, p, { branchId: "br2" }));
      expect(byId(await inv.listMovements(p, b.id))).toEqual(byId([head, br1, br2]));
      expect((await inv.listMovements(p, b.id, null)).map((m) => m.id)).toEqual([head.id]);
      expect((await inv.listMovements(p, b.id, "br1")).map((m) => m.id)).toEqual([br1.id]);
      expect(await inv.listMovements(p, b.id, "br-none")).toEqual([]);
    });
  });

  it("listMovementsByBusiness lists all movements of the business only", async () => {
    await withInventory(async (inv, ctx) => {
      const b1 = await seedBusiness(ctx);
      const b2 = await seedBusiness(ctx);
      const p1 = await seedProduct(ctx, b1.id);
      const p2 = await seedProduct(ctx, b1.id);
      const p3 = await seedProduct(ctx, b2.id);
      const m1 = await inv.createMovement(movementInput(b1.id, p1));
      const m2 = await inv.createMovement(movementInput(b1.id, p2, { branchId: "br1", qtyDelta: -2 }));
      const m3 = await inv.createMovement(movementInput(b2.id, p3));
      expect(byId(await inv.listMovementsByBusiness(b1.id))).toEqual(byId([m1, m2]));
      expect(byId(await inv.listMovementsByBusiness(b2.id))).toEqual(byId([m3]));
    });
  });

  it("listMovementsPage pages ascending by id: afterId null gives the first N, then the cursor continues", async () => {
    await withInventory(async (inv, ctx) => {
      const b = await seedBusiness(ctx);
      const p = await seedProduct(ctx, b.id);
      const other = await seedBusiness(ctx);
      const otherP = await seedProduct(ctx, other.id);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const m = await inv.createMovement(movementInput(b.id, p, { qtyDelta: i + 1 }));
        ids.push(m.id);
      }
      await inv.createMovement(movementInput(other.id, otherP));
      // afterId null → first N in ascending id order (JS text order, like memory).
      expect((await inv.listMovementsPage(b.id, null, 2)).map((m) => m.id)).toEqual([...ids].sort().slice(0, 2));
      const sorted = [...ids].sort();
      // After the 2nd id → the next two.
      expect((await inv.listMovementsPage(b.id, sorted[1], 2)).map((m) => m.id)).toEqual(sorted.slice(2, 4));
      expect((await inv.listMovementsPage(b.id, sorted[3], 2)).map((m) => m.id)).toEqual(sorted.slice(4));
      // Cursor past the last row → nothing; a big limit returns everything.
      expect(await inv.listMovementsPage(b.id, sorted[4], 2)).toEqual([]);
      expect((await inv.listMovementsPage(b.id, null, 10)).map((m) => m.id)).toEqual(sorted);
    });
  });

  it("movement nullable fields and signed qtyDelta round-trip", async () => {
    await withInventory(async (inv, ctx) => {
      const b = await seedBusiness(ctx);
      const p = await seedProduct(ctx, b.id);
      const input = movementInput(b.id, p, {
        qtyDelta: -3,
        type: "damage",
        reason: "broken bottles",
        referenceType: "sale",
        referenceId: "sale-1",
        branchId: "br1",
      });
      const created = await inv.createMovement(input);
      const listed = (await inv.listMovements(p, b.id, "br1"))[0];
      expect(listed).toEqual({ ...input, id: created.id });
    });
  });
});

describe("phase12 pg inventory: balances", () => {
  it("upsertBalance creates then updates the qty in place, keeping the same row", async () => {
    await withInventory(async (inv, ctx) => {
      const b = await seedBusiness(ctx);
      const p = await seedProduct(ctx, b.id);
      const created = await inv.upsertBalance({ businessId: b.id, productId: p, branchId: null, qtyOnHand: 10 });
      expect(created).toEqual({ id: created.id, businessId: b.id, productId: p, branchId: null, qtyOnHand: 10 });
      // Memory's findBalance default: omitted branch = head-office row.
      expect((await inv.findBalance(p, b.id))!.qtyOnHand).toBe(10);
      const updated = await inv.upsertBalance({ businessId: b.id, productId: p, branchId: null, qtyOnHand: 8 });
      expect(updated.id).toBe(created.id);
      expect(updated.qtyOnHand).toBe(8);
      expect((await inv.findBalance(p, b.id))!.qtyOnHand).toBe(8);
      expect((await inv.findBalance(p, b.id))!.id).toBe(created.id);
    });
  });

  it("findBalance distinguishes head-office and branch rows; omitted branch means head-office", async () => {
    await withInventory(async (inv, ctx) => {
      const b = await seedBusiness(ctx);
      const p = await seedProduct(ctx, b.id);
      await inv.upsertBalance({ businessId: b.id, productId: p, branchId: null, qtyOnHand: 5 });
      expect((await inv.findBalance(p, b.id, null))!.qtyOnHand).toBe(5);
      expect((await inv.findBalance(p, b.id))!.qtyOnHand).toBe(5);
      expect(await inv.findBalance(p, b.id, "br1")).toBeNull();
      await inv.upsertBalance({ businessId: b.id, productId: p, branchId: "br1", qtyOnHand: 7 });
      expect((await inv.findBalance(p, b.id, "br1"))!.qtyOnHand).toBe(7);
      // The branch upsert must not touch the head-office row.
      expect((await inv.findBalance(p, b.id))!.qtyOnHand).toBe(5);
      // Missing rows read null, never throw.
      expect(await inv.findBalance("prod-none", b.id)).toBeNull();
    });
  });

  it("upsertBalance keeps null-branch and per-branch rows distinct (one row per scope)", async () => {
    await withInventory(async (inv, ctx) => {
      const b = await seedBusiness(ctx);
      const p = await seedProduct(ctx, b.id);
      await inv.upsertBalance({ businessId: b.id, productId: p, branchId: null, qtyOnHand: 5 });
      await inv.upsertBalance({ businessId: b.id, productId: p, branchId: "br1", qtyOnHand: 7 });
      const br2 = await inv.upsertBalance({ businessId: b.id, productId: p, branchId: "br2", qtyOnHand: 9 });
      const rows = await inv.listBalances(b.id);
      expect(rows.map((r) => r.qtyOnHand).sort((a, z) => a - z)).toEqual([5, 7, 9]);
      // Re-upserting a scope updates that scope's row only.
      const again = await inv.upsertBalance({ businessId: b.id, productId: p, branchId: "br1", qtyOnHand: 11 });
      expect(again.id).not.toBe(br2.id);
      const after = await inv.listBalances(b.id);
      expect(after).toHaveLength(3);
      expect(after.find((r) => r.branchId === "br1")!.qtyOnHand).toBe(11);
      expect(after.find((r) => r.branchId === null)!.qtyOnHand).toBe(5);
      expect(after.find((r) => r.branchId === "br2")!.qtyOnHand).toBe(9);
    });
  });

  it("listBalances returns only the business's rows", async () => {
    await withInventory(async (inv, ctx) => {
      const b1 = await seedBusiness(ctx);
      const b2 = await seedBusiness(ctx);
      const p1 = await seedProduct(ctx, b1.id);
      const p2 = await seedProduct(ctx, b2.id);
      await inv.upsertBalance({ businessId: b1.id, productId: p1, branchId: null, qtyOnHand: 3 });
      await inv.upsertBalance({ businessId: b2.id, productId: p2, branchId: "br1", qtyOnHand: 4 });
      const own = await inv.listBalances(b1.id);
      expect(own).toHaveLength(1);
      expect(own[0].qtyOnHand).toBe(3);
      expect(await inv.listBalances("biz-none")).toEqual([]);
    });
  });

  it("cross-tenant isolation: a second business sees nothing", async () => {
    await withInventory(async (inv, ctx) => {
      const b1 = await seedBusiness(ctx);
      const b2 = await seedBusiness(ctx);
      const p1 = await seedProduct(ctx, b1.id);
      await inv.createMovement(movementInput(b1.id, p1, { branchId: "br1" }));
      await inv.upsertBalance({ businessId: b1.id, productId: p1, branchId: "br1", qtyOnHand: 6 });
      expect(await inv.listMovements(p1, b2.id)).toEqual([]);
      expect(await inv.listMovements(p1, b2.id, "br1")).toEqual([]);
      expect(await inv.listMovementsByBusiness(b2.id)).toEqual([]);
      expect(await inv.listMovementsPage(b2.id, null, 10)).toEqual([]);
      expect(await inv.findBalance(p1, b2.id)).toBeNull();
      expect(await inv.findBalance(p1, b2.id, "br1")).toBeNull();
      expect(await inv.listBalances(b2.id)).toEqual([]);
    });
  });
});

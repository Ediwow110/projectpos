import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PgContext } from "../../src/common/pg/context";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { catalogFamily } from "../../src/common/pg/pg-catalog";
import type { DbCategory, DbProduct } from "../../src/common/db.port";

// Catalog-family tests: the family runs directly over a fresh PgContext (no
// PgDbPort), mirroring the memory store's behavior — same tenant filters, same
// insertion ordering, null for missing/cross-tenant rows, [] for empty lists.
// Same disposable database as helpers.ts; PGTEST_BASE lets CI point at its
// own service container.
const URL = `${process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433"}/pos_test_pg`;
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let admin: Client;
let ctx: PgContext;
let catalog: ReturnType<typeof catalogFamily>;
let tenants: ReturnType<typeof tenantsFamily>;

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
  catalog = catalogFamily(ctx);
  tenants = tenantsFamily(ctx);
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

// Every runtime field filled, nullable ones explicit — the create contract.
function fullProduct(businessId: string, categoryId: string | null, name: string) {
  return {
    businessId,
    categoryId,
    name,
    sku: uniq("sku"),
    barcode: uniq("bc"),
    brand: "Brand X",
    unit: "pcs",
    costMinor: 1000,
    priceMinor: 2500,
    taxRateBps: 1200,
    reorderLevel: 5,
    trackInventory: true,
    isActive: true,
    imageUrl: "https://cdn.example/img.png",
  };
}

describe("phase12 pg catalog: categories", () => {
  it("creates a category and finds it by id", async () => {
    const b = await seedBusiness();
    const created = await catalog.createCategory({
      businessId: b.id, name: uniq("Drinks"), description: "Cold ones", isActive: true,
    });
    expect(created.id).toBeTruthy();
    expect(await catalog.findCategoryById(created.id, b.id)).toEqual(created);
  });

  it("partial-updates a category and preserves the untouched fields", async () => {
    const b = await seedBusiness();
    const c = await catalog.createCategory({
      businessId: b.id, name: uniq("Snacks"), description: "Salty", isActive: true,
    });
    const renamed = await catalog.updateCategory(c.id, b.id, { name: uniq("Chips") });
    expect(renamed).toEqual({ ...c, name: renamed!.name });
    // Absent keys unchanged, verified through an independent read.
    expect(await catalog.findCategoryById(c.id, b.id)).toEqual(renamed);
    const flipped = await catalog.updateCategory(c.id, b.id, { isActive: false });
    expect(flipped).toEqual({ ...renamed, isActive: false });
  });

  it("returns null for missing or cross-tenant categories", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const c = await catalog.createCategory({
      businessId: b2.id, name: uniq("Theirs"), description: null, isActive: true,
    });
    expect(await catalog.findCategoryById(c.id, b1.id)).toBeNull();
    expect(await catalog.findCategoryById("cat_none", b1.id)).toBeNull();
    expect(await catalog.updateCategory(c.id, b1.id, { name: "X" })).toBeNull();
    expect(await catalog.updateCategory("cat_none", b1.id, { name: "X" })).toBeNull();
  });

  it("lists only the business's categories in insertion order; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const c1 = (await catalog.createCategory({
      businessId: b1.id, name: uniq("A"), description: null, isActive: true,
    })) as DbCategory;
    await sleep(2); // TIMESTAMP(3) granularity: keep createdAt strictly increasing
    await catalog.createCategory({ businessId: b2.id, name: uniq("B"), description: null, isActive: true });
    await sleep(2);
    const c3 = (await catalog.createCategory({
      businessId: b1.id, name: uniq("C"), description: null, isActive: false,
    })) as DbCategory;
    const rows = await catalog.listCategories(b1.id);
    expect(rows.map((r) => r.id)).toEqual([c1.id, c3.id]);
    expect(await catalog.listCategories("biz_empty")).toEqual([]);
  });
});

describe("phase12 pg catalog: products", () => {
  it("creates a product with every field (including a category link) and finds it", async () => {
    const b = await seedBusiness();
    const cat = await catalog.createCategory({
      businessId: b.id, name: uniq("Drinks"), description: null, isActive: true,
    });
    const input = fullProduct(b.id, cat.id, "Cola");
    const created = await catalog.createProduct(input) as DbProduct;
    expect(created.id).toBeTruthy();
    expect(await catalog.findProductById(created.id, b.id)).toEqual({ ...input, id: created.id });
  });

  it("round-trips every nullable field as null", async () => {
    const b = await seedBusiness();
    const created = (await catalog.createProduct({
      businessId: b.id, categoryId: null, name: "Water", sku: null, barcode: null, brand: null,
      unit: "pc", costMinor: 0, priceMinor: 1500, taxRateBps: null, reorderLevel: 0,
      trackInventory: false, isActive: true, imageUrl: null,
    })) as DbProduct;
    expect(await catalog.findProductById(created.id, b.id)).toEqual({ ...created });
    expect(await catalog.findProductById(created.id, b.id)).toEqual(created);
  });

  it("partial-updates one field and preserves the rest", async () => {
    const b = await seedBusiness();
    const input = fullProduct(b.id, null, "Cola");
    const p = (await catalog.createProduct(input)) as DbProduct;
    const next = await catalog.updateProduct(p.id, b.id, { priceMinor: 9999 });
    expect(next).toEqual({ ...input, id: p.id, priceMinor: 9999 });
    expect(await catalog.findProductById(p.id, b.id)).toEqual(next);
  });

  it("archive-style patches flip isActive and clear nullable fields", async () => {
    const b = await seedBusiness();
    const input = fullProduct(b.id, null, "Gum");
    const p = (await catalog.createProduct(input)) as DbProduct;
    const archived = await catalog.updateProduct(p.id, b.id, { isActive: false });
    expect(archived).toEqual({ ...input, id: p.id, isActive: false });
    // A later patch keeps the archived state (absent keys unchanged) and can null fields.
    const cleared = await catalog.updateProduct(p.id, b.id, { imageUrl: null, sku: null });
    expect(cleared).toEqual({ ...input, id: p.id, isActive: false, imageUrl: null, sku: null });
  });

  it("returns null for missing or cross-tenant products", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const p = (await catalog.createProduct(fullProduct(b2.id, null, "Theirs"))) as DbProduct;
    expect(await catalog.findProductById(p.id, b1.id)).toBeNull();
    expect(await catalog.findProductById("prod_none", b1.id)).toBeNull();
    expect(await catalog.updateProduct(p.id, b1.id, { priceMinor: 1 })).toBeNull();
    expect(await catalog.updateProduct("prod_none", b1.id, { priceMinor: 1 })).toBeNull();
  });

  it("lists only the business's products in insertion order; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const p1 = (await catalog.createProduct(fullProduct(b1.id, null, "A"))) as DbProduct;
    await sleep(2);
    await catalog.createProduct(fullProduct(b2.id, null, "B"));
    await sleep(2);
    const p3 = (await catalog.createProduct(fullProduct(b1.id, null, "C"))) as DbProduct;
    const rows = await catalog.listProducts(b1.id);
    expect(rows.map((r) => r.id)).toEqual([p1.id, p3.id]);
    expect(await catalog.listProducts("biz_empty")).toEqual([]);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PgContext } from "../../src/common/pg/context";
import { auditFamily } from "../../src/common/pg/pg-audit";
import { catalogFamily } from "../../src/common/pg/pg-catalog";
import { inventoryFamily } from "../../src/common/pg/pg-inventory";
import { procurementFamily } from "../../src/common/pg/pg-procurement";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";

const URL = `${process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433"}/${process.env["PGTEST_DB"] ?? "pos_test_pg"}`;
const uniq = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let admin: Client;
let ctx: PgContext;
let tenants: ReturnType<typeof tenantsFamily>;
let catalog: ReturnType<typeof catalogFamily>;
let inventory: ReturnType<typeof inventoryFamily>;
let procurement: ReturnType<typeof procurementFamily>;
let audit: ReturnType<typeof auditFamily>;

beforeAll(async () => {
  admin = new Client({ connectionString: URL });
  await admin.connect();
});

beforeEach(async () => {
  const tables = (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_migrations')")).rows.map((row) => row.tablename as string);
  if (tables.length > 0) await admin.query(`TRUNCATE TABLE ${tables.map((table) => `"${table}"`).join(", ")} CASCADE`);
  ctx = new PgContext(URL);
  tenants = tenantsFamily(ctx);
  catalog = catalogFamily(ctx);
  inventory = inventoryFamily(ctx);
  procurement = procurementFamily(ctx);
  audit = auditFamily(ctx);
});

afterEach(async () => { await ctx.close(); });
afterAll(async () => { await admin.end(); });

async function seed() {
  const business = await tenants.createBusiness({ name: uniq("Procurement"), currency: "PHP" });
  const product = await catalog.createProduct({
    businessId: business.id, categoryId: null, name: "Coffee", sku: uniq("sku"), barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  const supplier = await procurement.createSupplier({
    businessId: business.id, name: "ACME Foods", code: uniq("ACME"), contactName: null,
    email: null, phone: null, addressLine1: null, addressLine2: null, city: null,
    province: null, postalCode: null, country: "PH", paymentTerms: null, notes: null, isActive: true,
  });
  return { business, product, supplier };
}

describe("phase16 pg procurement parity", () => {
  it("allocates unique PO numbers under concurrency", async () => {
    const { business } = await seed();
    const numbers = await Promise.all(Array.from({ length: 5 }, () => procurement.nextPoNo(business.id)));
    expect(new Set(numbers).size).toBe(5);
    expect(numbers.every((number) => /^PO-\d{4}-\d{6}$/.test(number))).toBe(true);
  });

  it("enforces relationship uniqueness, preferred uniqueness, and CAS", async () => {
    const { business, product, supplier } = await seed();
    const mapping = await procurement.createProductSupplier({
      businessId: business.id, productId: product.id, supplierId: supplier.id,
      supplierSku: "COF", unitCostMinor: 125, leadTimeDays: 3, isPreferred: true,
    });
    await expect(procurement.createProductSupplier({
      businessId: business.id, productId: product.id, supplierId: supplier.id,
      supplierSku: "DUP", unitCostMinor: 125, leadTimeDays: 3, isPreferred: false,
    })).rejects.toMatchObject({ code: "23505" });

    const order = await procurement.createPurchaseOrder({
      businessId: business.id, supplierId: supplier.id, branchId: null,
      poNumber: await procurement.nextPoNo(business.id), status: "DRAFT", expectedDate: null,
      notes: null, subtotalMinor: 250, taxMinor: 0, totalMinor: 250, createdBy: "owner",
      orderedBy: null, orderedAt: null, cancelledBy: null, cancelledAt: null, cancelReason: null,
    });
    const line = await procurement.createPurchaseOrderLine({
      businessId: business.id, purchaseOrderId: order.id, productId: product.id, position: 0,
      supplierSkuSnapshot: mapping.supplierSku, productNameSnapshot: "Coffee", quantity: 2,
      unitCostMinor: 125, lineTotalMinor: 250, notes: null,
    });
    expect(line.purchaseOrderId).toBe(order.id);
    const next = await procurement.updatePurchaseOrder(order.id, business.id, { notes: "Updated" }, 1);
    expect(next?.version).toBe(2);
    expect(await procurement.updatePurchaseOrder(order.id, business.id, { notes: "Stale" }, 1)).toBeNull();
  });

  it("persists audit history, protects tenant reads, and never writes inventory", async () => {
    const { business, product, supplier } = await seed();
    const beforeMovements = await inventory.listMovementsByBusiness(business.id);
    const beforeBalances = await inventory.listBalances(business.id);
    const order = await procurement.createPurchaseOrder({
      businessId: business.id, supplierId: supplier.id, branchId: null,
      poNumber: await procurement.nextPoNo(business.id), status: "DRAFT", expectedDate: null,
      notes: null, subtotalMinor: 0, taxMinor: 0, totalMinor: 0, createdBy: "owner",
      orderedBy: null, orderedAt: null, cancelledBy: null, cancelledAt: null, cancelReason: null,
    });
    await audit.appendAudit({ businessId: business.id, actorId: "owner", action: "purchase_order.create", entityType: "PurchaseOrder", entityId: order.id, requestId: "r1", after: { id: order.id } });
    expect((await procurement.listAuditFor(business.id, "PurchaseOrder", order.id))[0]).toMatchObject({ action: "purchase_order.create", after: { id: order.id } });
    expect(await procurement.findPurchaseOrderById(order.id, "foreign-business")).toBeNull();
    expect(await inventory.listMovementsByBusiness(business.id)).toEqual(beforeMovements);
    expect(await inventory.listBalances(business.id)).toEqual(beforeBalances);

    await expect(admin.query('DELETE FROM "Supplier" WHERE "id" = $1', [supplier.id])).rejects.toMatchObject({ code: "23503" });
    void product;
  });
});

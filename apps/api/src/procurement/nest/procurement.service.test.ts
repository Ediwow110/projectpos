import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ProcurementService } from "./procurement.service";

const WRITE = ["supplier.write", "purchase_order.write", "purchase_order.order", "purchase_order.cancel"];

async function setup() {
  const db = createMemoryDb();
  const svc = new ProcurementService(db);
  const business = await db.createBusiness({ name: "Procurement", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const productA = await db.createProduct({ businessId: business.id, categoryId: null, name: "Product A", sku: "A", barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
  const productB = await db.createProduct({ businessId: business.id, categoryId: null, name: "Product B", sku: "B", barcode: null, brand: null, unit: "pc", costMinor: 250, priceMinor: 400, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
  await db.createMovement({ businessId: business.id, productId: productA.id, type: "opening_stock", qtyDelta: 8, reason: null, referenceType: null, referenceId: null, actorId: "seed", requestId: "seed", branchId: branch.id });
  await db.upsertBalance({ businessId: business.id, productId: productA.id, branchId: branch.id, qtyOnHand: 8 });
  return { db, svc, businessId: business.id, branchId: branch.id, productA, productB };
}

describe("Phase 16 procurement service", () => {
  it("runs supplier → mapping → draft → edit → order without inventory effects", async () => {
    const { db, svc, businessId, branchId, productA, productB } = await setup();
    const beforeMovements = await db.listMovementsByBusiness(businessId);
    const beforeBalances = await db.listBalances(businessId);
    const supplierInput = { name: " ACME Foods ", code: " acme " };
    const created = await svc.createSupplier(businessId, "owner", "r1", "supplier-key", supplierInput, WRITE);
    const replay = await svc.createSupplier(businessId, "owner", "r2", "supplier-key", supplierInput, WRITE);
    expect(replay.replayed).toBe(true);
    expect(created.supplier.code).toBe("ACME");

    const mapping = await svc.createProductSupplier(businessId, "owner", "r3", created.supplier.id, { productId: productA.id, supplierSku: "A-ACME", unitCostMinor: 125, isPreferred: true }, WRITE);
    expect(mapping.isPreferred).toBe(true);
    const draft = await svc.createPurchaseOrder(businessId, "owner", "r4", "po-create", { supplierId: created.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 2 }, { productId: productB.id, quantity: 3, unitCostMinor: 300 }] }, WRITE);
    expect(draft.purchaseOrder.status).toBe("DRAFT");
    expect(draft.purchaseOrder.lines.map((line) => line.unitCostMinor)).toEqual([125, 300]);
    expect(draft.purchaseOrder.totalMinor).toBe(1150);
    const updated = await svc.updatePurchaseOrder(businessId, "owner", "r5", draft.purchaseOrder.id, 1, { lines: [{ productId: productA.id, quantity: 4 }] }, WRITE);
    expect(updated.version).toBe(2);
    expect(updated.totalMinor).toBe(500);
    const ordered = await svc.orderPurchaseOrder(businessId, "owner", "r6", draft.purchaseOrder.id, "order-key", updated.version, WRITE);
    expect(ordered.purchaseOrder.status).toBe("ORDERED");
    expect(ordered.purchaseOrder.lines[0]?.supplierSkuSnapshot).toBe("A-ACME");
    await expect(svc.updatePurchaseOrder(businessId, "owner", "r7", draft.purchaseOrder.id, ordered.purchaseOrder.version, { notes: "late" }, WRITE)).rejects.toThrow("PURCHASE_ORDER_INVALID_STATE");
    await expect(svc.updatePurchaseOrder(businessId, "owner", "r8", draft.purchaseOrder.id, 1, { notes: "stale" }, WRITE)).rejects.toThrow("PURCHASE_ORDER_INVALID_STATE");
    const cancelled = await svc.cancelPurchaseOrder(businessId, "owner", "r9", draft.purchaseOrder.id, "cancel-key", "Supplier changed", ordered.purchaseOrder.version, WRITE);
    expect(cancelled.purchaseOrder.status).toBe("CANCELLED");
    expect(await db.listMovementsByBusiness(businessId)).toEqual(beforeMovements);
    expect(await db.listBalances(businessId)).toEqual(beforeBalances);
    expect((await db.listAudit()).map((row) => row.action)).toEqual(expect.arrayContaining(["supplier.create", "product_supplier.create", "purchase_order.create", "purchase_order.update", "purchase_order.ordered", "purchase_order.cancelled"]));
  });

  it("rejects stale drafts, inactive suppliers, duplicate mappings, and cashier writes", async () => {
    const { svc, businessId, branchId, productA, productB } = await setup();
    const supplier = await svc.createSupplier(businessId, "owner", "r1", "supplier-key", { name: "ACME" }, WRITE);
    await expect(svc.createSupplier(businessId, "cashier", "r2", "cashier-key", { name: "Nope" }, [])).rejects.toThrow("FORBIDDEN");
    await svc.createProductSupplier(businessId, "owner", "r3", supplier.supplier.id, { productId: productA.id, unitCostMinor: 100 }, WRITE);
    await expect(svc.createProductSupplier(businessId, "owner", "r3-invalid", supplier.supplier.id, { productId: productB.id, unitCostMinor: -1 }, WRITE)).rejects.toThrow("VALIDATION");
    await expect(svc.createProductSupplier(businessId, "owner", "r4", supplier.supplier.id, { productId: productA.id }, WRITE)).rejects.toThrow("PRODUCT_SUPPLIER_DUPLICATE");
    await svc.setSupplierActive(businessId, "owner", "r5", supplier.supplier.id, false, WRITE);
    await expect(svc.createPurchaseOrder(businessId, "owner", "r6", "po-key", { supplierId: supplier.supplier.id, branchId, lines: [] }, WRITE)).rejects.toThrow("SUPPLIER_INACTIVE");
  });

  it("rejects conflicting idempotency payloads and stale version updates", async () => {
    const { svc, businessId, branchId, productA } = await setup();
    const supplier = await svc.createSupplier(businessId, "owner", "r1", "supplier-key", { name: "ACME" }, WRITE);
    const draft = await svc.createPurchaseOrder(businessId, "owner", "r2", "po-key", { supplierId: supplier.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 1 }] }, WRITE);
    await expect(svc.createPurchaseOrder(businessId, "owner", "r3", "po-key", { supplierId: supplier.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 2 }] }, WRITE)).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await svc.updatePurchaseOrder(businessId, "owner", "r4", draft.purchaseOrder.id, 1, { notes: "new" }, WRITE);
    await expect(svc.updatePurchaseOrder(businessId, "owner", "r5", draft.purchaseOrder.id, 1, { notes: "lost" }, WRITE)).rejects.toThrow("STALE_VERSION");
  });
});

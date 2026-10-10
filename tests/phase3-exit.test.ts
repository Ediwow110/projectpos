import { describe, expect, it } from "vitest";
import { validateQtyDelta } from "../apps/api/src/inventory/signs";
import { computeBalanceFromLedger, deriveStockStatus } from "../apps/api/src/inventory/projection";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { InventoryService } from "../apps/api/src/inventory/nest/inventory.service";

describe("phase3 exit", () => {
  it("opening->receive->damage->adjust leaves balance equal to ledger sum", async () => {
    const db = createMemoryDb();
    const businessId = (await db.createBusiness({ name: "Phase 3", currency: "PHP" })).id;
    const prod = await db.createProduct({
      businessId, categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
      reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
    });
    const svc = new InventoryService(db);
    await svc.recordMovement(businessId, "u1", "r1", { productId: prod.id, type: "opening_stock", qtyDelta: 100 });
    await svc.recordMovement(businessId, "u1", "r2", { productId: prod.id, type: "receive", qtyDelta: 20 });
    await svc.recordMovement(businessId, "u1", "r3", { productId: prod.id, type: "damage", qtyDelta: -2, reason: "2 broken" });
    await svc.recordMovement(businessId, "u1", "r4", { productId: prod.id, type: "adjustment", qtyDelta: 1, reason: "recount" });
    const bal = await db.findBalance(prod.id, businessId);
    const ledger = await db.listMovements(prod.id, businessId);
    expect(bal!.qtyOnHand).toBe(119);
    expect(bal!.qtyOnHand).toBe(computeBalanceFromLedger(ledger));
  });
  it("oversell is rejected and sign validation holds", async () => {
    expect(() => validateQtyDelta("sale", 5)).toThrow("VALIDATION");
    expect(deriveStockStatus({ qtyOnHand: 2, reorderLevel: 5, trackInventory: true })).toBe("low");
  });
  it("concurrent receives keep balance equal to ledger sum", async () => {
    const db = createMemoryDb();
    const businessId = (await db.createBusiness({ name: "Phase 3", currency: "PHP" })).id;
    const prod = await db.createProduct({
      businessId, categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
      reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
    });
    const svc = new InventoryService(db);
    await svc.recordMovement(businessId, "u1", "r0", { productId: prod.id, type: "opening_stock", qtyDelta: 500 });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        svc.recordMovement(businessId, "u1", "rc" + i, { productId: prod.id, type: "receive", qtyDelta: 1 }),
      ),
    );
    const bal = await db.findBalance(prod.id, businessId);
    const ledger = await db.listMovements(prod.id, businessId);
    expect(bal!.qtyOnHand).toBe(computeBalanceFromLedger(ledger));
  });
  it("rebuild detects zero drift on a healthy tenant", async () => {
    const db = createMemoryDb();
    const prod = await db.createProduct({
      businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
      reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
    });
    const svc = new InventoryService(db);
    await svc.recordMovement("b1", "u1", "r1", { productId: prod.id, type: "receive", qtyDelta: 7 });
    const out = await svc.rebuild("b1", "u1", "rr");
    expect(out.drifts).toEqual([]);
  });
});

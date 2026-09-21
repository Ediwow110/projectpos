import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase3 inventory port", () => {
  it("round-trips a movement scoped to its business", async () => {
    const db = createMemoryDb();
    await db.createMovement({
      businessId: "b1", productId: "p1", type: "receive", qtyDelta: 10,
      reason: null, referenceType: null, referenceId: null,
      actorId: "u1", requestId: "r1",
    });
    expect((await db.listMovements("p1", "b1")).length).toBe(1);
    expect(await db.listMovements("p1", "b2")).toEqual([]);
  });
  it("upserts balances scoped to business", async () => {
    const db = createMemoryDb();
    await db.upsertBalance({ businessId: "b1", productId: "p1", qtyOnHand: 10 });
    expect((await db.findBalance("p1", "b1"))!.qtyOnHand).toBe(10);
    expect(await db.findBalance("p1", "b2")).toBeNull();
    expect(await db.listBalances("b2")).toEqual([]);
  });
});

import { InventoryService } from "./inventory.service";
import { computeBalanceFromLedger } from "../projection";

async function setupSvc() {
  const d = createMemoryDb();
  const prod = await d.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 100, priceMinor: 250, taxRateBps: null,
    reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
  });
  return { db: d, svc: new InventoryService(d), productId: prod.id };
}

describe("phase3 inventory service", () => {
  it("opening stock then receive leaves balance equal to ledger sum", async () => {
    const { db, svc, productId } = await setupSvc();
    await svc.recordMovement("b1", "u1", "r1", { productId, type: "opening_stock", qtyDelta: 100 });
    await svc.recordMovement("b1", "u1", "r2", { productId, type: "receive", qtyDelta: 20 });
    const bal = await db.findBalance(productId, "b1");
    const ledger = await db.listMovements(productId, "b1");
    expect(bal!.qtyOnHand).toBe(120);
    expect(bal!.qtyOnHand).toBe(computeBalanceFromLedger(ledger));
  });
  it("rejects oversell with INSUFFICIENT_STOCK and writes nothing", async () => {
    const { db, svc, productId } = await setupSvc();
    await svc.recordMovement("b1", "u1", "r1", { productId, type: "receive", qtyDelta: 5 });
    await expect(
      svc.recordMovement("b1", "u1", "r2", { productId: productId, type: "damage", qtyDelta: -10, reason: "broken bottles" }),
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    expect((await db.listMovements(productId, "b1")).length).toBe(1);
  });
  it("rejects untracked product with PRODUCT_NOT_TRACKED", async () => {
    const d = createMemoryDb();
    const prod = await d.createProduct({
      businessId: "b1", categoryId: null, name: "Service", sku: null, barcode: null,
      brand: null, unit: "svc", costMinor: 0, priceMinor: 500, taxRateBps: null,
      reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null,
    });
    const svc = new InventoryService(d);
    await expect(
      svc.recordMovement("b1", "u1", "r1", { productId: prod.id, type: "receive", qtyDelta: 1 }),
    ).rejects.toThrow("PRODUCT_NOT_TRACKED");
  });
  it("interleaved concurrent movements keep balance equal to ledger sum", async () => {
    const { db, svc, productId } = await setupSvc();
    await svc.recordMovement("b1", "u1", "r0", { productId, type: "opening_stock", qtyDelta: 1000 });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        svc.recordMovement("b1", "u1", "rc" + i, { productId, type: "receive", qtyDelta: 1 }),
      ),
    );
    const bal = await db.findBalance(productId, "b1");
    const ledger = await db.listMovements(productId, "b1");
    expect(bal!.qtyOnHand).toBe(computeBalanceFromLedger(ledger));
  });
  it("rebuild reports zero drift on healthy tenant", async () => {
    const { svc, productId } = await setupSvc();
    await svc.recordMovement("b1", "u1", "r1", { productId, type: "receive", qtyDelta: 7 });
    const out = await svc.rebuild("b1", "u1", "rr");
    expect(out.drifts).toEqual([]);
    expect(out.checked).toBeGreaterThanOrEqual(1);
  });
});

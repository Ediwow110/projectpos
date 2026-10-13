import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { StockExceptionService } from "./stock-exception.service";

async function fixture() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Phase C Store", currency: "PHP" });
  const otherBusiness = await db.createBusiness({ name: "Another Store", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Stock room", type: "store", isActive: true });
  const otherBranch = await db.createBranch({ businessId: business.id, name: "Other room", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Milk", sku: "MILK",
    barcode: null, brand: null, unit: "pc", priceMinor: 800, costMinor: 500,
    taxRateBps: null, reorderLevel: 3, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: business.id, productId: product.id, branchId: branch.id, qtyOnHand: 10 });
  await db.upsertBalance({ businessId: business.id, productId: product.id, branchId: otherBranch.id, qtyOnHand: 8 });
  return { db, business, otherBusiness, branch, otherBranch, product, svc: new StockExceptionService(db) };
}

const inventoryGrant = ["inventory.adjust"];

describe("stock risk register and audited disposition", () => {
  it("reports dated/damaged goods without stock mutation and replays the same key exactly", async () => {
    const { db, business, product, branch, svc } = await fixture();
    const input = {
      productId: product.id, branchId: branch.id, kind: "EXPIRY" as const,
      expiresOn: "2026-10-30", quantity: 3, reason: "Batch expires soon",
    };
    const first = await svc.report(business.id, "inventory-staff", "req-1", "report-1", input, inventoryGrant, { activeBranchId: branch.id });
    expect(first.replayed).toBe(false);
    expect(first.row).toMatchObject({ kind: "EXPIRY", status: "OPEN", expiresOn: "2026-10-30" });
    const retry = await svc.report(business.id, "inventory-staff", "req-2", "report-1", input, inventoryGrant, { activeBranchId: branch.id });
    expect(retry).toMatchObject({ replayed: true, row: { id: first.row.id } });
    await expect(svc.report(business.id, "inventory-staff", "req-3", "report-1", { ...input, quantity: 2 }, inventoryGrant, { activeBranchId: branch.id }))
      .rejects.toThrow("IDEMPOTENCY_MISMATCH");
    expect((await db.listMovements(product.id, business.id, branch.id))).toHaveLength(0);
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(10);
    expect((await db.listAudit()).map((audit) => audit.action)).toContain("stock_exception.report");
  });

  it("disposes exactly once with one negative movement and an audited branch balance", async () => {
    const { db, business, product, branch, otherBranch, svc } = await fixture();
    const report = await svc.report(business.id, "staff", "report", "risk-1", {
      productId: product.id, branchId: branch.id, kind: "DAMAGE", quantity: 3, reason: "Broken containers",
    }, inventoryGrant, { activeBranchId: branch.id });
    const [first, retry] = await Promise.all([
      svc.dispose(business.id, "owner", "dispose-a", report.row.id, inventoryGrant, { activeBranchId: branch.id }),
      svc.dispose(business.id, "owner", "dispose-b", report.row.id, inventoryGrant, { activeBranchId: branch.id }),
    ]);
    expect([first.replayed, retry.replayed].sort()).toEqual([false, true]);
    const movements = await db.listMovements(product.id, business.id, branch.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "damage", qtyDelta: -3, referenceType: "StockException", referenceId: report.row.id });
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(7);
    expect((await db.findBalance(product.id, business.id, otherBranch.id))?.qtyOnHand).toBe(8);
    expect((await svc.list(business.id, { activeBranchId: branch.id }))[0]).toMatchObject({
      status: "DISPOSED", movementId: movements[0]!.id,
    });
    expect((await db.listAudit()).filter((audit) => audit.action === "stock_exception.dispose")).toHaveLength(1);
  });

  it("fails closed for wrong permissions, cross-tenant/branch, and over-disposal", async () => {
    const { db, business, otherBusiness, branch, otherBranch, product, svc } = await fixture();
    const details = {
      productId: product.id, branchId: branch.id, kind: "DAMAGE" as const,
      quantity: 11, reason: "Damaged while unloading",
    };
    await expect(svc.report(business.id, "cashier", "bad", "cashier", details, [], {})).rejects.toThrow("FORBIDDEN");
    await expect(svc.report(business.id, "inventory", "cross", "cross", details, inventoryGrant, {
      allowedBranchIds: [otherBranch.id], activeBranchId: otherBranch.id,
    })).rejects.toThrow("FORBIDDEN");
    const row = (await svc.report(business.id, "inventory", "ok", "valid", details, inventoryGrant, { activeBranchId: branch.id })).row;
    expect(await svc.list(otherBusiness.id, {})).toHaveLength(0);
    await expect(svc.dispose(otherBusiness.id, "owner", "wrong", row.id, inventoryGrant, {})).rejects.toThrow("NOT_FOUND");
    await expect(svc.dispose(business.id, "inventory", "wrong-branch", row.id, inventoryGrant, {
      allowedBranchIds: [otherBranch.id], activeBranchId: otherBranch.id,
    })).rejects.toThrow("FORBIDDEN");
    await expect(svc.dispose(business.id, "owner", "not-enough", row.id, inventoryGrant, { activeBranchId: branch.id }))
      .rejects.toThrow("INSUFFICIENT_STOCK");
    expect((await db.findStockExceptionById(row.id, business.id))?.status).toBe("OPEN");
    expect(await db.listMovements(product.id, business.id, branch.id)).toHaveLength(0);
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(10);
  });

  it("rejects malformed and nonexistent expiry dates", async () => {
    const { business, branch, product, svc } = await fixture();
    for (const expiresOn of ["2026-02-30", "10/14/2026", "2026-13-01", ""]) {
      await expect(svc.report(business.id, "owner", "date", `date-${expiresOn}`, {
        productId: product.id, branchId: branch.id, kind: "EXPIRY", quantity: 1,
        expiresOn, reason: "Expires soon",
      }, inventoryGrant, {})).rejects.toThrow("VALIDATION");
    }
  });
});

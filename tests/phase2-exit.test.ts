import { describe, expect, it } from "vitest";
import { normalizeSku, findDuplicateBarcode } from "../apps/api/src/catalog/normalize";
import { applyProductSearch, redactProductForRole } from "../apps/api/src/catalog/search";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { CatalogService } from "../apps/api/src/catalog/nest/catalog.service";

describe("phase2 exit", () => {
  it("cashier searches a bounded catalog without seeing cost", () => {
    const rows = [
      { id: "p1", businessId: "b1", name: "Coke", sku: "COKE-1", barcode: "111", categoryId: null, costMinor: 1000, priceMinor: 2500, isActive: true },
    ];
    const out = applyProductSearch(rows, { q: "coke", active: "true", page: 1, pageSize: 20 });
    expect(out.total).toBe(1);
    expect(redactProductForRole(out.items[0], [])).not.toHaveProperty("costMinor");
  });
  it("manager changes catalog data with audit entries", async () => {
    const db = createMemoryDb();
    const svc = new CatalogService(db);
    const p = await svc.createProduct("b1", "u1", "r1", { name: "Coke", priceMinor: 2500 });
    await svc.updateProduct("b1", "u1", "r1", p.id, { priceMinor: 2600 });
    const actions = (await db.listAudit()).map((a) => a.action);
    expect(actions).toContain("product.create");
    expect(actions).toContain("product.update");
  });
  it("cross-tenant catalog access is blocked", async () => {
    const db = createMemoryDb();
    const svc = new CatalogService(db);
    const p = await svc.createProduct("b1", "u1", "r1", { name: "Coke", priceMinor: 2500 });
    await expect(svc.getProduct("b2", p.id, [])).rejects.toThrow("NOT_FOUND");
  });
  it("duplicate barcode rejected, normalization holds", () => {
    expect(normalizeSku(" ab-1 ")).toBe("AB-1");
    expect(findDuplicateBarcode([{ barcode: "1" }, { barcode: "1" }])).toBe(1);
  });
});

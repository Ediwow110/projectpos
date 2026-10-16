import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";
import { StockExceptionService } from "../../src/inventory/nest/stock-exception.service";

describe("Phase C stock issues PostgreSQL persistence", () => {
  it("persists open observations, enforces tenant boundaries, disposes atomically once, and enables RLS", async () => {
    await withPg(async (db, ctx) => {
      const tenant = await db.createBusiness({ name: "Phase C PG", currency: "PHP" });
      const foreign = await db.createBusiness({ name: "Other Phase C", currency: "PHP" });
      const product = await db.createProduct({
        businessId: tenant.id, name: "Dated rice", sku: "RICE", categoryId: null, barcode: null,
        brand: null, unit: "pc", priceMinor: 200, costMinor: 120,
        taxRateBps: null, reorderLevel: 1, trackInventory: true, isActive: true, imageUrl: null,
      });
      await expect(db.createStockException({
        businessId: foreign.id, productId: product.id, branchId: null,
        kind: "DAMAGE", quantity: 1, expiresOn: null, reason: "Invalid tenant reference",
        status: "OPEN", reportKey: "invalid-parent", reportedBy: "owner",
        disposedBy: null, disposedAt: null, movementId: null,
      })).rejects.toThrow("NOT_FOUND");
      await db.upsertBalance({ businessId: tenant.id, productId: product.id, branchId: null, qtyOnHand: 10 });
      const svc = new StockExceptionService(db);
      const details = {
        productId: product.id, branchId: null, kind: "EXPIRY" as const,
        quantity: 4, expiresOn: "2027-04-01", reason: "Rice batch B2",
      };
      const result = await svc.report(tenant.id, "owner", "risk-pg", "risk-pg-key", details, ["inventory.adjust"], {});
      expect(result.replayed).toBe(false);
      expect(await db.findStockExceptionById(result.row.id, foreign.id)).toBeNull();
      expect(await db.findStockExceptionByKey(tenant.id, "risk-pg-key")).toMatchObject({ status: "OPEN", expiresOn: "2027-04-01" });
      expect(await db.listStockExceptions(foreign.id)).toEqual([]);
      expect((await db.findBalance(product.id, tenant.id, null))?.qtyOnHand).toBe(10);
      const disposed = await svc.dispose(tenant.id, "owner", "dispose-pg", result.row.id, ["inventory.adjust"], {});
      expect(disposed.replayed).toBe(false);
      expect(disposed.row).toMatchObject({ status: "DISPOSED", quantity: 4 });
      expect((await svc.dispose(tenant.id, "owner", "dispose-pg-repeat", result.row.id, ["inventory.adjust"], {})).replayed).toBe(true);
      expect(await db.listMovements(product.id, tenant.id, null)).toHaveLength(1);
      expect((await db.findBalance(product.id, tenant.id, null))?.qtyOnHand).toBe(6);
      const client = await ctx.client();
      try {
        const row = await client.query('SELECT "relrowsecurity" FROM pg_class WHERE "relname" = $1', ["StockException"]);
        expect(row.rows[0]?.relrowsecurity).toBe(true);
      } finally { if (ctx.owns()) client.release(); }
    });
  });
});

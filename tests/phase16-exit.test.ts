import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ROLE_SEED } from "../apps/api/src/tenant/seed";
import { SENSITIVE_ACTIONS } from "../packages/auth/src/permissions";

describe("phase16 exit", () => {
  it("ships the additive procurement migration with RLS on every table", () => {
    const sql = readFileSync("packages/database/prisma/migrations/0028_procurement/migration.sql", "utf8");
    for (const table of ["Supplier", "ProductSupplier", "POCounter", "PurchaseOrder", "PurchaseOrderLine"]) {
      expect(sql).toContain(`CREATE TABLE \"${table}\"`);
      expect(sql).toContain(`ALTER TABLE \"${table}\" ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("keeps the Phase 16 migration commercially isolated from inventory and cash writes", () => {
    const sql = readFileSync("packages/database/prisma/migrations/0028_procurement/migration.sql", "utf8");
    expect(sql).not.toMatch(/InventoryMovement|InventoryBalance|CashMovement|Sale|Expense|Shift/);
  });

  it("registers the four server-enforced permission keys without granting cashiers", () => {
    for (const permission of ["supplier.write", "purchase_order.write", "purchase_order.order", "purchase_order.cancel"]) {
      expect(SENSITIVE_ACTIONS).toContain(permission);
      expect(ROLE_SEED.owner).toContain(permission);
      expect(ROLE_SEED.manager).toContain(permission);
      expect(ROLE_SEED.inventory).toContain(permission);
      expect(ROLE_SEED.cashier).not.toContain(permission);
    }
  });

  it("exposes both procurement navigation destinations", () => {
    const source = readFileSync("apps/web/src/lib/workspace-navigation.ts", "utf8");
    expect(source).toContain('href: "/suppliers"');
    expect(source).toContain('href: "/purchase-orders"');
    expect(source).toContain('group("Procurement"');
  });
});

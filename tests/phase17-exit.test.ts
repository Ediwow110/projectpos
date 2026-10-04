import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ROLE_SEED } from "../apps/api/src/tenant/seed";
import { SENSITIVE_ACTIONS } from "../packages/auth/src/permissions";

describe("phase17 exit", () => {
  it("ships additive receipt and supplier-return tables with RLS", () => {
    const sql = readFileSync("packages/database/prisma/migrations/0029_phase17_receiving_returns/migration.sql", "utf8");
    for (const table of ["PurchaseReceiptCounter", "PurchaseReceipt", "PurchaseReceiptLine", "SupplierReturnCounter", "SupplierReturn", "SupplierReturnLine"]) {
      expect(sql).toContain(`CREATE TABLE \"${table}\"`);
      expect(sql).toContain(`ALTER TABLE \"${table}\" ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("PARTIALLY_RECEIVED");
    expect(sql).toContain("RECEIVED");
  });

  it("uses explicit supplier_return movement semantics and preserves costing", () => {
    const signs = readFileSync("apps/api/src/inventory/signs.ts", "utf8");
    const service = readFileSync("apps/api/src/procurement/nest/procurement.service.ts", "utf8");
    expect(signs).toContain('"supplier_return"');
    expect(service).toContain('type: "supplier_return"');
    expect(service).not.toMatch(/this\.db\.updateProduct\(/);
  });

  it("grants Phase 17 writes only to operational roles", () => {
    for (const permission of ["purchase_order.receive", "supplier_return.write", "supplier_return.post", "supplier_return.cancel"]) {
      expect(SENSITIVE_ACTIONS).toContain(permission);
      expect(ROLE_SEED.owner).toContain(permission);
      expect(ROLE_SEED.manager).toContain(permission);
      expect(ROLE_SEED.inventory).toContain(permission);
      expect(ROLE_SEED.cashier).not.toContain(permission);
    }
  });

  it("exposes supplier returns without exposing them to cashiers", () => {
    const source = readFileSync("apps/web/src/lib/workspace-navigation.ts", "utf8");
    expect(source).toContain('href: "/supplier-returns"');
    expect(source).toContain('group("Procurement"');
    const cashier = ROLE_SEED.cashier;
    expect(cashier).not.toContain("supplier_return.post");
  });
});

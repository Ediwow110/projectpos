import { describe, expect, it } from "vitest";
import { ROLE_SEED } from "./seed";

const PROCUREMENT = ["supplier.write", "purchase_order.write", "purchase_order.order", "purchase_order.cancel"];

describe("Phase 16 procurement grants", () => {
  it("grants procurement writes to owner, manager, and inventory roles", () => {
    for (const role of ["owner", "manager", "inventory"] as const) {
      expect(ROLE_SEED[role]).toEqual(expect.arrayContaining(PROCUREMENT));
    }
  });

  it("keeps every procurement write out of cashier permissions", () => {
    for (const permission of PROCUREMENT) expect(ROLE_SEED.cashier).not.toContain(permission);
  });
});

describe("Phase 23 accounting grants", () => {
  const accounting = ["accounting.read", "accounting.manage", "payables.read", "payables.write", "payables.pay"];
  it("grants accounting and AP permissions to owners and managers", () => {
    for (const role of ["owner", "manager"] as const) expect(ROLE_SEED[role]).toEqual(expect.arrayContaining(accounting));
  });
  it("keeps accounting and AP permissions out of cashier and inventory defaults", () => {
    for (const role of ["cashier", "inventory"] as const) {
      for (const permission of accounting) expect(ROLE_SEED[role]).not.toContain(permission);
    }
  });
});

import { describe, expect, it } from "vitest";
import { buildRegistrationSeed, resolveActiveBusiness } from "../src/tenant/seed";

describe("registration seed", () => {
  it("owner holds all sensitive actions", async () => {
    const seed = await buildRegistrationSeed({
      ownerName: "Ana",
      email: "ana@example.com",
      password: "correct-horse-12",
      businessName: "Sari Store",
    });
    expect(seed.roles.owner.sort()).toEqual([...seed.allPermissions].sort());
  });
  it("cashier lacks refund and settings", async () => {
    const seed = await buildRegistrationSeed({
      ownerName: "Ana",
      email: "ana@example.com",
      password: "correct-horse-12",
      businessName: "Sari Store",
    });
    expect(seed.roles.cashier).not.toContain("sale.refund");
    expect(seed.roles.cashier).not.toContain("settings.write");
  });
  it("manager lacks user management but keeps refunds", async () => {
    const seed = await buildRegistrationSeed({
      ownerName: "Ana",
      email: "ana@example.com",
      password: "correct-horse-12",
      businessName: "Sari Store",
    });
    expect(seed.roles.manager).not.toContain("user.manage");
    expect(seed.roles.manager).toContain("sale.refund");
  });
  it("resolves active business only from explicit membership", () => {
    expect(resolveActiveBusiness(["b1", "b2"], "b2")).toBe("b2");
    expect(() => resolveActiveBusiness(["b1"], "b9")).toThrow("TENANT_MISMATCH");
  });
  it("defaults currency to PHP", async () => {
    const seed = await buildRegistrationSeed({
      ownerName: "Ana",
      email: "ana@example.com",
      password: "correct-horse-12",
      businessName: "Sari Store",
    });
    expect(seed.business.currency).toBe("PHP");
  });
});

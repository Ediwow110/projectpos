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
    expect(seed.roles.cashier.filter((p) => p.startsWith("order.")).sort()).toEqual([
      "order.accept",
      "order.collect",
      "order.create",
      "order.submit",
      "order.view",
    ]);
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
    expect(seed.roles.manager.filter((p) => p.startsWith("order.")).sort()).toEqual([
      "order.accept",
      "order.cancel",
      "order.collect",
      "order.create",
      "order.fulfill",
      "order.link_customer",
      "order.manage_access",
      "order.submit",
      "order.view",
      "order.view_delivery_details",
    ]);
  });
  it("inventory gets fulfillment visibility without financial or access-management authority", async () => {
    const seed = await buildRegistrationSeed({
      ownerName: "Ana",
      email: "ana@example.com",
      password: "correct-horse-12",
      businessName: "Sari Store",
    });
    expect(seed.roles.inventory.filter((p) => p.startsWith("order.")).sort()).toEqual([
      "order.fulfill",
      "order.view",
      "order.view_delivery_details",
    ]);
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
    expect(seed.defaultSettings).toEqual(expect.arrayContaining([
      { key: "onlineOrderingEnabled", value: false },
      { key: "onlinePickupBranchIds", value: [] },
      { key: "onlineFulfillmentBranchId", value: null },
      { key: "deliveryFlatFeeMinor", value: 0 },
    ]));
  });
});

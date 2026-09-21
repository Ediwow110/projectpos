import { describe, expect, it } from "vitest";

describe("phase3 inventory web helpers", () => {
  it("builds a balances query string", async () => {
    const { buildBalancesSearch } = await import("../src/lib/inventory");
    expect(buildBalancesSearch({ view: "low", page: 1, pageSize: 20 })).toBe(
      "/api/v1/inventory/balances?view=low&page=1&pageSize=20",
    );
  });
  it("gates the movement form by role", async () => {
    const { canAdjustInventory, statusLabel } = await import("../src/lib/inventory");
    expect(canAdjustInventory("cashier")).toBe(false);
    expect(canAdjustInventory("inventory")).toBe(true);
    expect(statusLabel("low")).toBe("LOW");
  });
});

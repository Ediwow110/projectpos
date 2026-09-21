import { describe, expect, it } from "vitest";

describe("phase2 catalog web helpers", () => {
  it("builds a bounded search query string", async () => {
    const { buildProductSearch } = await import("../src/lib/catalog");
    expect(buildProductSearch({ q: "coke", page: 1, pageSize: 20 })).toBe(
      "/api/v1/products?q=coke&page=1&pageSize=20",
    );
  });
  it("hides cost for cashier role", async () => {
    const { canSeeCost, canEditCatalog } = await import("../src/lib/catalog");
    expect(canSeeCost("cashier")).toBe(false);
    expect(canSeeCost("owner")).toBe(true);
    expect(canEditCatalog("cashier")).toBe(false);
    expect(canEditCatalog("manager")).toBe(true);
  });
});

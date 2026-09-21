import { describe, expect, it } from "vitest";
import { normalizeProductInput, findDuplicateSku } from "./normalize";
import { matchesQuery, applyProductSearch, redactProductForRole } from "./search";

const rows = [
  { id: "p1", businessId: "b1", name: "Coke", sku: "COKE-1", barcode: "111", categoryId: "c1", brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null },
  { id: "p2", businessId: "b1", name: "Pepsi", sku: null, barcode: null, categoryId: null, brand: null, unit: "pc", costMinor: 900, priceMinor: 2400, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: false, imageUrl: null },
];

describe("phase2 catalog domain", () => {
  it("normalizes sku to uppercase and blanks to null", () => {
    expect(normalizeProductInput({ name: " x ", sku: " ab-1 ", barcode: "" }).sku).toBe("AB-1");
    expect(normalizeProductInput({ name: " x ", sku: "", barcode: "" }).sku).toBeNull();
  });
  it("detects duplicate sku case-insensitively", () => {
    expect(findDuplicateSku([{ sku: "a-1" }, { sku: "A-1" }])).toBe(1);
    expect(findDuplicateSku([{ sku: "a-1" }, { sku: "b-2" }])).toBe(-1);
  });
  it("matches name substring, sku substring, barcode exact", () => {
    expect(matchesQuery(rows[0], "cok")).toBe(true);
    expect(matchesQuery(rows[0], "oke-")).toBe(true);
    expect(matchesQuery(rows[0], "111")).toBe(true);
    expect(matchesQuery(rows[0], "11")).toBe(false);
    expect(matchesQuery(rows[0], "zzz")).toBe(false);
  });
  it("paginates active products deterministically", () => {
    const out = applyProductSearch(rows, { active: "true", page: 1, pageSize: 20 });
    expect(out.total).toBe(1);
    expect(out.items[0].id).toBe("p1");
  });
  it("redacts cost without cost.view permission", () => {
    expect(redactProductForRole(rows[0], [])).not.toHaveProperty("costMinor");
    expect(redactProductForRole(rows[0], ["cost.view"])).toHaveProperty("costMinor", 1000);
  });
});

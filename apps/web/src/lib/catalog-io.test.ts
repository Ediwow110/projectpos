import { describe, expect, it } from "vitest";
import { parseProductCsv, productRowsToCsv } from "./catalog-io";

describe("catalog CSV I/O", () => {
  it("parses product CSV into API import items", () => {
    expect(parseProductCsv('name,sku,price,cost,reorder_level,track_inventory\n"Iced, Latte",LAT-1,149.50,70.25,5,yes')).toEqual([
      { name: "Iced, Latte", sku: "LAT-1", priceMinor: 14950, costMinor: 7025, reorderLevel: 5, trackInventory: true },
    ]);
  });

  it("rejects malformed required values", () => {
    expect(() => parseProductCsv("name,price\nCoffee,nope")).toThrow("invalid price");
  });

  it("exports visible rows without hidden fields", () => {
    expect(productRowsToCsv([{ name: "Iced, Latte", sku: null, priceMinor: 14950, isActive: true }])).toBe(
      'name,sku,price,status\n"Iced, Latte",,149.50,active\n',
    );
  });
});

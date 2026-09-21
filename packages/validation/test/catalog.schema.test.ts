import { describe, expect, it } from "vitest";
import {
  categoryCreateSchema,
  productCreateSchema,
  productSearchSchema,
} from "../src/catalog.schema";

describe("phase2 catalog schemas", () => {
  it("rejects negative price with MONEY_NEGATIVE", () => {
    expect(() =>
      productCreateSchema.parse({ name: "Soda", priceMinor: -100, costMinor: 0 }),
    ).toThrow();
  });
  it("rejects non-integer money with MONEY_NOT_INTEGER", () => {
    expect(() =>
      productCreateSchema.parse({ name: "Soda", priceMinor: 10.5, costMinor: 0 }),
    ).toThrow();
  });
  it("rejects pageSize over 100", () => {
    expect(() => productSearchSchema.parse({ pageSize: 101 })).toThrow();
  });
  it("rejects empty category name", () => {
    expect(() => categoryCreateSchema.parse({ name: "" })).toThrow();
  });
  it("accepts a minimal valid product", () => {
    const out = productCreateSchema.parse({ name: "Soda", priceMinor: 2500 });
    expect(out.unit).toBe("pc");
    expect(out.trackInventory).toBe(true);
  });
});

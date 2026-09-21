import { describe, expect, it } from "vitest";
import { moneyMinorSchema, priceSchema, quantitySchema } from "../src/money.schema";

describe("PLAN 6.2 schema guards", () => {
  it("rejects negative price", () => {
    expect(() => priceSchema.parse(-100)).toThrow();
  });
  it("rejects float money", () => {
    expect(() => moneyMinorSchema.parse(10.5)).toThrow();
  });
  it("rejects zero quantity", () => {
    expect(() => quantitySchema.parse(0)).toThrow();
  });
  it("accepts valid centavos price", () => {
    expect(priceSchema.parse(10050)).toBe(10050);
  });
});

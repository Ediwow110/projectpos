import { describe, expect, it } from "vitest";
import { normalizeOrderEmail, normalizeOrderPhone } from "./order-contact";

describe("phase22 guest contact normalization", () => {
  it("normalizes email by trim + lowercase", () => {
    expect(normalizeOrderEmail("  Ana.Reyes@Example.COM ")).toBe("ana.reyes@example.com");
  });

  it("normalizes phone punctuation while preserving optional leading +", () => {
    expect(normalizeOrderPhone(" +63 (917) 123-4567 ")).toBe("+639171234567");
    expect(normalizeOrderPhone("0917.123.4567")).toBe("09171234567");
  });

  it("rejects malformed phone values", () => {
    for (const value of ["+63abc", "123", "++639171234567", "63917 ext 1"]) {
      expect(() => normalizeOrderPhone(value)).toThrow("VALIDATION");
    }
  });
});

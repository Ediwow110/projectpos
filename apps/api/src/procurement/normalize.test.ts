import { describe, expect, it } from "vitest";
import { normalizeSupplierCode, normalizeSupplierPayload, parseExpectedDate, parsePurchaseOrderFilterDate } from "./normalize";

describe("procurement normalization", () => {
  it("normalizes supplier identity without changing historical snapshots", () => {
    expect(normalizeSupplierCode(" acme-01 ")).toBe("ACME-01");
    expect(normalizeSupplierCode("   ")).toBeNull();
    expect(normalizeSupplierPayload({ name: " ACME Foods ", code: " acme ", email: "BUYER@EXAMPLE.COM" })).toMatchObject({ name: "ACME Foods", code: "ACME", email: "buyer@example.com" });
  });

  it("accepts bounded ISO dates and rejects malformed or distant dates", () => {
    expect(parseExpectedDate("2026-10-03")).toBeInstanceOf(Date);
    expect(() => parseExpectedDate("not-a-date")).toThrow("VALIDATION");
    expect(() => parseExpectedDate("1900-01-01")).toThrow("VALIDATION");
  });

  it("allows historical list filters outside the PO create window", () => {
    expect(parsePurchaseOrderFilterDate("2020-01-01")).toEqual(new Date("2020-01-01T00:00:00.000Z"));
  });
});

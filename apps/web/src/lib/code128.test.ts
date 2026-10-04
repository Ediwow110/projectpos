import { describe, expect, it } from "vitest";
import { code128Checksum, encodeCode128 } from "./code128";

describe("Code 128 Set B", () => {
  it("encodes deterministic start/checksum/stop symbols", () => {
    const encoded = encodeCode128("ABC");
    expect(encoded.symbols).toEqual([104, 33, 34, 35, 1, 106]);
    expect(code128Checksum("ABC")).toBe(1);
    expect(encoded.modules.startsWith("0".repeat(10))).toBe(true);
    expect(encoded.modules.endsWith("0".repeat(10))).toBe(true);
  });

  it.each(["000123456789", "NXP-TEST-001", "QA-PH19-SMALL-BLACK"]) ("preserves %s exactly", (value) => {
    const encoded = encodeCode128(value);
    expect(encoded.value).toBe(value);
    expect(encoded.symbols[0]).toBe(104);
    expect(encoded.symbols.at(-1)).toBe(106);
  });

  it("rejects values outside printable ASCII", () => {
    expect(() => encodeCode128("bad\nvalue")).toThrow("BARCODE_UNENCODABLE");
    expect(() => encodeCode128("")).toThrow("BARCODE_UNENCODABLE");
  });
});

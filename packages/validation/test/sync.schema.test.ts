import { describe, expect, it } from "vitest";
import { deviceEnrollSchema, syncCheckSchema } from "../src/sync.schema";

describe("phase9b sync schemas", () => {
  it("rejects empty device labels", () => {
    expect(() => deviceEnrollSchema.parse({ label: "" })).toThrow();
  });
  it("accepts a trimmed label", () => {
    expect(deviceEnrollSchema.parse({ label: "Back counter" }).label).toBe("Back counter");
  });
  it("rejects empty key batches and oversized batches", () => {
    expect(() => syncCheckSchema.parse({ keys: [] })).toThrow();
    expect(() =>
      syncCheckSchema.parse({ keys: Array.from({ length: 101 }, (_, i) => ({ key: `k${i}`, commandType: "sale.complete" })) }),
    ).toThrow();
  });
  it("accepts a well-formed key batch", () => {
    const out = syncCheckSchema.parse({ keys: [{ key: "k1", commandType: "sale.complete" }] });
    expect(out.keys.length).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { getCorrelationId, isSafeCorrelationId } from "../correlation";

describe("phase21 request correlation", () => {
  it("accepts bounded safe IDs and rejects injection-shaped or oversized IDs", () => {
    expect(getCorrelationId({ "x-request-id": "checkout-123" })).toBe("checkout-123");
    expect(getCorrelationId({ "x-request-id": `${"a".repeat(129)}` })).not.toHaveLength(129);
    expect(getCorrelationId({ "x-request-id": "ok\nlevel=error" })).not.toContain("\n");
    expect(isSafeCorrelationId("checkout-123")).toBe(true);
    expect(isSafeCorrelationId("bad\nheader")).toBe(false);
  });

  it("does not trust an unsafe fallback", () => {
    const id = getCorrelationId({}, "user\r\nforged: true");
    expect(id).not.toContain("\r");
    expect(id).not.toContain("\n");
  });
});

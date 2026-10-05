import { describe, expect, it } from "vitest";
import { classifyFailure, percentile, redactSample } from "./phase21-mix.mjs";

describe("phase21 load harness", () => {
  it("calculates bounded percentiles and classifies timeouts", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([], 95)).toBe(0);
    expect(classifyFailure({ name: "AbortError" })).toBe("timeout");
    expect(classifyFailure(Object.assign(new Error("nope"), { status: 503 }))).toBe("server_error");
  });

  it("redacts credentials and URLs from failure samples", () => {
    const value = redactSample("POST https://example.test/x password=secret email=owner@example.test");
    expect(value).not.toContain("https://");
    expect(value).not.toContain("secret");
    expect(value).not.toContain("owner@example.test");
  });
});

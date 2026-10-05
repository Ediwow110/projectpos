import { describe, expect, it } from "vitest";
import { createLogger } from "../logger";

describe("phase21 structured logging", () => {
  it("redacts credential, bearer, and personal contact material", () => {
    const line = createLogger().info({ correlationId: "req-1", route: "/api/v1/sales", status: 500 }, "password=shh bearer abc123 email jane@example.com phone +63 917 555 0199");
    expect(line).not.toContain("shh");
    expect(line).not.toContain("abc123");
    expect(line).not.toContain("jane@example.com");
    expect(line).not.toContain("917 555 0199");
    expect(line).toContain("REDACTED");
  });
});

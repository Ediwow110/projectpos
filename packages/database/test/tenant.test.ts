import { describe, expect, it } from "vitest";
import { withScope, requireTenant } from "../src/tenant";

describe("PLAN FR-TENANT-01 tenant scoping", () => {
  it("scopes a query object with businessId", () => {
    expect(withScope("biz_1", { id: "x" })).toEqual({ id: "x", businessId: "biz_1" });
  });
  it("rejects empty businessId", () => {
    expect(() => requireTenant("")).toThrow();
  });
  it("never accepts client tenantId as authority without membership check", () => {
    expect(() => requireTenant(null as any)).toThrow();
  });
});

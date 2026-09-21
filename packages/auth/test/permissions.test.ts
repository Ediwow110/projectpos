import { describe, expect, it } from "vitest";
import { hasPermission } from "../src/permissions";

describe("PLAN FR-RBAC-01 scope check", () => {
  it("allows permission within same business scope", () => {
    expect(hasPermission(["sale.refund"], "sale.refund", "biz_1", "biz_1")).toBe(true);
  });
  it("denies cross-business scope even with permission key", () => {
    expect(hasPermission(["sale.refund"], "sale.refund", "biz_1", "biz_2")).toBe(false);
  });
  it("denies missing permission", () => {
    expect(hasPermission([], "settings.write", "biz_1", "biz_1")).toBe(false);
  });
});

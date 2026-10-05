import { describe, expect, it } from "vitest";
import { hasPermission, SENSITIVE_ACTIONS } from "../src/permissions";

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

  it("registers the complete Phase 22 order permission family", () => {
    expect(SENSITIVE_ACTIONS).toEqual(expect.arrayContaining([
      "order.view",
      "order.create",
      "order.submit",
      "order.accept",
      "order.cancel",
      "order.fulfill",
      "order.collect",
      "order.view_delivery_details",
      "order.link_customer",
      "order.manage_access",
    ]));
  });
});
